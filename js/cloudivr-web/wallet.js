'use strict'
// Wallet for web accounts — the SAME walletOf documents the bot engine bills (calls, forwarding, renewals).
const MIN_TOPUP_USD = 10
const round2 = (n) => Math.round(Number(n) * 100) / 100
const livePayments = () => process.env.WEB_CLOUDIVR_DRY_RUN !== 'true' || !!process.env.WEB_DYNO_PAY_API_KEY

function walletOps(db) {
  const walletOf = db.collection('walletOf')
  const balance = async (chatId) => {
    const w = await walletOf.findOne({ _id: String(chatId) })
    return round2((w?.usdIn || 0) - (w?.usdOut || 0))
  }
  // Atomic: only debits when the balance covers it (no overdraft race between two tabs).
  const debit = async (chatId, amount) => {
    const amt = round2(amount)
    if (!(amt > 0)) return amt === 0
    const r = await walletOf.updateOne(
      { _id: String(chatId), $expr: { $gte: [{ $subtract: [{ $ifNull: ['$usdIn', 0] }, { $ifNull: ['$usdOut', 0] }] }, amt] } },
      { $inc: { usdOut: amt } },
    )
    return r.modifiedCount === 1
  }
  const credit = async (chatId, amount) => {
    const amt = round2(amount)
    if (amt > 0) await walletOf.updateOne({ _id: String(chatId) }, { $inc: { usdIn: amt } }, { upsert: true })
  }
  return { balance, debit, credit }
}

const CREDITS = { 'referral-reward': 'Referral reward', 'suggestion-reward': 'Free credit · adopted suggestion' }
const LABEL = { purchase: 'Number purchase', purchase_verification: 'Number purchase (verification)', renew: 'Number renewal', upgrade: 'Plan upgrade', release: 'Number deleted' }

function routes(router, { db, h, coins, createCryptoDeposit }) {
  const w = walletOps(db)

  router.get('/wallet', h(async (req, res) => {
    const id = req.webChatId
    const [tx, ptx, deposits] = await Promise.all([
      db.collection('transactions').find({ chatId: String(id) }).sort({ createdAt: -1 }).limit(50).toArray(),
      db.collection('phoneTransactions').find({ chatId: id }).sort({ timestamp: -1 }).limit(50).toArray(),
      db.collection('webDeposits').find({ chatId: id }).sort({ createdAt: -1 }).limit(20).toArray(),
    ])
    const paidRefs = new Set(tx.filter(t => t.type === 'wallet-topup').map(t => t.metadata?.ref).filter(Boolean))
    const history = [
      ...ptx.filter(t => Number(t.amount) > 0).map(t => ({ id: String(t._id), at: t.timestamp, type: t.action, description: `${LABEL[t.action] || t.action} · ${t.phoneNumber || ''}`, amount: -Math.abs(Number(t.amount) || 0) })),
      ...tx.filter(t => t.type === 'wallet-topup').map(t => ({ id: String(t._id), at: new Date(t.createdAt).toISOString(), type: t.type, description: `Crypto top-up · ${t.metadata?.value || ''} ${t.metadata?.coin || ''}`.trim(), amount: Math.abs(Number(t.amount) || 0) })),
      ...tx.filter(t => CREDITS[t.type]).map(t => ({ id: String(t._id), at: new Date(t.createdAt).toISOString(), type: t.type, description: CREDITS[t.type], amount: Math.abs(Number(t.amount) || 0) })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 50)
    res.json({
      balance: await w.balance(id), currency: 'USD', minTopup: MIN_TOPUP_USD, coins, history,
      deposits: deposits.map(d => ({ ref: d.ref, amountUsd: d.amountUsd, coin: d.coin, address: d.address, amountCrypto: d.amountCrypto, createdAt: d.createdAt, status: paidRefs.has(d.ref) ? 'credited' : 'waiting' })),
    })
  }))

  router.post('/wallet/topup', h(async (req, res) => {
    const amountUsd = round2(req.body.amountUsd)
    const coin = String(req.body.coin || '')
    if (!(amountUsd >= MIN_TOPUP_USD) || amountUsd > 10000) return res.status(400).json({ error: 'invalid_amount', message: `Top up between $${MIN_TOPUP_USD} and $10,000.` })
    if (!coins.includes(coin)) return res.status(400).json({ error: 'invalid_coin', message: `Pick one of: ${coins.join(', ')}.` })
    // Preview without the web DynoPay key: no payment session is created — a clearly labelled placeholder address is returned.
    const dep = !livePayments()
      ? { ref: `dry-${Date.now().toString(36)}`, address: 'PREVIEW-MODE-DO-NOT-SEND-FUNDS', amountCrypto: null, provider: 'preview', dryRun: true }
      : await createCryptoDeposit(req.webChatId, amountUsd, coin)
    if (!dep || !dep.address) return res.status(424).json({ error: 'deposit_unavailable', message: 'The crypto payment service did not return an address. Try again or pick another coin.' })
    await db.collection('webDeposits').insertOne({ chatId: req.webChatId, ref: dep.ref, amountUsd, coin, address: dep.address, amountCrypto: dep.amountCrypto || null, provider: dep.provider, createdAt: new Date() })
    res.status(201).json({ ref: dep.ref, address: dep.address, amountCrypto: dep.amountCrypto || null, coin, amountUsd, provider: dep.provider, dryRun: !!dep.dryRun, note: dep.dryRun ? 'Preview mode: no payment was created. Do not send any funds.' : 'Send exactly this amount. Your balance updates automatically once the network confirms the payment.' })
  }))
}

module.exports = { walletOps, routes, MIN_TOPUP_USD, round2, livePayments }
