'use strict'
// Wallet for web accounts — the SAME walletOf documents the bot engine bills (calls, forwarding, renewals).
const MIN_TOPUP_USD = 10
const round2 = (n) => Math.round(Number(n) * 100) / 100
// Debits/credits keep sub-cent prices exact (e.g. $0.015 lookups); balances still show cents.
const round4 = (n) => Math.round(Number(n) * 10000) / 10000
// Unpaid crypto payments show as expired after this; a late payment is still credited (shown as 'paid_late').
const PAY_WINDOW_MS = 6 * 3600000
const expiresAt = (d) => new Date(new Date(d.createdAt).getTime() + PAY_WINDOW_MS)
const depositStatus = (d, paidAt) => {
  if (paidAt) return new Date(paidAt) > expiresAt(d) ? 'paid_late' : 'paid'
  if (d.provider === 'preview') return 'test'
  return Date.now() > expiresAt(d).getTime() ? 'expired' : 'waiting'
}
const livePayments = () => process.env.WEB_CLOUDIVR_DRY_RUN !== 'true' || !!process.env.WEB_DYNO_PAY_API_KEY

function walletOps(db) {
  const walletOf = db.collection('walletOf')
  const balance = async (chatId) => {
    const w = await walletOf.findOne({ _id: String(chatId) })
    return round4((w?.usdIn || 0) - (w?.usdOut || 0))
  }
  // Atomic: only debits when the balance covers it (no overdraft race between two tabs).
  const debit = async (chatId, amount) => {
    const amt = round4(amount)
    if (!(amt > 0)) return amt === 0
    const r = await walletOf.updateOne(
      { _id: String(chatId), $expr: { $gte: [{ $subtract: [{ $ifNull: ['$usdIn', 0] }, { $ifNull: ['$usdOut', 0] }] }, amt] } },
      { $inc: { usdOut: amt } },
    )
    return r.modifiedCount === 1
  }
  const credit = async (chatId, amount) => {
    const amt = round4(amount)
    if (amt > 0) await walletOf.updateOne({ _id: String(chatId) }, { $inc: { usdIn: amt } }, { upsert: true })
  }
  return { balance, debit, credit }
}

const CREDITS = { 'hosted-sms-refund': 'Refund · Landline to Texting', 'topup-bonus': 'Top-up bonus', 'admin-credit': 'Credit from CloudIVR', 'referral-reward': 'Referral reward', 'suggestion-reward': 'Free credit · adopted suggestion', 'sms-refund': 'Refund · text not delivered', 'lead-check-refund': 'Refund · numbers we couldn’t check' }
const HOSTED = { 'hosted-sms-setup': 'Landline to Texting setup', 'hosted-sms-renewal': 'Landline to Texting monthly', 'hosted-sms-text': 'Text sent · Landline to Texting', 'hosted-sms-inbound': 'Text received · Landline to Texting', 'lead-check': 'Lead check', 'cnam-lookup': 'Owner-name lookup', 'caller-id-verify': 'Caller ID verification' }
const LABEL = { purchase: 'Number purchase', purchase_verification: 'Number purchase (verification)', renew: 'Number renewal', upgrade: 'Plan upgrade', release: 'Number deleted', sms_reply: 'Extra text' }

function routes(router, { db, h, coins, createCryptoDeposit, offers, cryptoPerUsd }) {
  const w = walletOps(db)
  const rateCache = { at: 0, rates: null }

  // Coins per 1 USD for every coin (display only; the exact amount comes with the address). Cached for a minute.
  router.get('/wallet/rates', h(async (req, res) => {
    if (!rateCache.rates || Date.now() - rateCache.at > 60000) {
      const got = await Promise.all(coins.map(c => (cryptoPerUsd ? cryptoPerUsd(c).catch(() => null) : null)))
      const rates = Object.fromEntries(coins.map((c, i) => [c, Number(got[i]) > 0 ? Number(got[i]) : null]))
      if (Object.values(rates).some(Boolean)) Object.assign(rateCache, { at: Date.now(), rates })
      else return res.json({ rates, at: null })
    }
    res.json({ rates: rateCache.rates, at: new Date(rateCache.at).toISOString() })
  }))

  router.get('/wallet', h(async (req, res) => {
    const id = req.webChatId
    const [tx, ptx, deposits] = await Promise.all([
      db.collection('transactions').find({ chatId: String(id) }).sort({ createdAt: -1 }).limit(50).toArray(),
      db.collection('phoneTransactions').find({ chatId: id }).sort({ timestamp: -1 }).limit(50).toArray(),
      db.collection('webDeposits').find({ chatId: id }).sort({ createdAt: -1 }).limit(20).toArray(),
    ])
    const paidAt = new Map(tx.filter(t => t.type === 'wallet-topup' && t.metadata?.ref).map(t => [t.metadata.ref, t.createdAt]))
    const history = [
      ...ptx.filter(t => Number(t.amount) > 0).map(t => ({ id: String(t._id), at: t.timestamp, type: t.action, description: `${LABEL[t.action] || t.action} · ${t.phoneNumber || ''}`, amount: -Math.abs(Number(t.amount) || 0) })),
      ...tx.filter(t => t.type === 'wallet-topup').map(t => ({ id: String(t._id), at: new Date(t.createdAt).toISOString(), type: t.type, description: `Crypto top-up · ${t.metadata?.value || ''} ${t.metadata?.coin || ''}`.trim(), amount: Math.abs(Number(t.amount) || 0) })),
      ...tx.filter(t => HOSTED[t.type]).map(t => ({ id: String(t._id), at: new Date(t.createdAt).toISOString(), type: t.type, description: `${HOSTED[t.type]} · ${t.metadata?.phoneNumber || (t.metadata?.count ? `${t.metadata.count} number${t.metadata.count === 1 ? '' : 's'}` : '')}`, amount: -Math.abs(Number(t.amount) || 0) })),
      ...tx.filter(t => CREDITS[t.type]).map(t => ({ id: String(t._id), at: new Date(t.createdAt).toISOString(), type: t.type, description: `${CREDITS[t.type]}${t.metadata?.phoneNumber && t.type === 'hosted-sms-refund' ? ` · ${t.metadata.phoneNumber}` : ''}${t.type === 'lead-check-refund' ? ` · ${t.metadata?.count} number${t.metadata?.count === 1 ? '' : 's'}` : ''}`, amount: Math.abs(Number(t.amount) || 0) })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 50)
    res.json({
      balance: await w.balance(id), currency: 'USD', minTopup: MIN_TOPUP_USD, coins, history,
      deposits: deposits.map(d => ({ ref: d.ref, amountUsd: d.amountUsd, coin: d.coin, address: d.address, amountCrypto: d.amountCrypto, createdAt: d.createdAt, expiresAt: expiresAt(d), status: depositStatus(d, paidAt.get(d.ref)) })),
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
    const bonus = offers ? await offers.topupBonusFor(req.webChatId).catch(() => null) : null
    await db.collection('webDeposits').insertOne({ chatId: req.webChatId, ref: dep.ref, amountUsd, coin, address: dep.address, amountCrypto: dep.amountCrypto || null, provider: dep.provider, bonus, bonusPaidAt: null, createdAt: new Date() })
    res.status(201).json({ bonus, expiresAt: expiresAt({ createdAt: new Date() }), ref: dep.ref, address: dep.address, amountCrypto: dep.amountCrypto || null, coin, amountUsd, provider: dep.provider, dryRun: !!dep.dryRun, note: dep.dryRun ? 'Preview mode: no payment was created. Do not send any funds.' : 'Send exactly this amount. Your balance updates automatically once the network confirms the payment.' })
  }))
}

module.exports = { walletOps, routes, MIN_TOPUP_USD, round2, livePayments, PAY_WINDOW_MS }
