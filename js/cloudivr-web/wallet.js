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
  if (d.provider === 'mollie') return { canceled: 'canceled', expired: 'expired', failed: 'failed', error: 'failed' }[d.mollieStatus] || 'waiting'
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

const CREDITS = { 'hosted-sms-refund': 'Refund · Business texting', 'topup-bonus': 'Top-up bonus', 'first-deposit-bonus': 'First deposit bonus', 'admin-credit': 'Credit from CloudIVR', 'referral-reward': 'Referral reward', 'suggestion-reward': 'Free credit · adopted suggestion', 'sms-refund': 'Refund · text not delivered', 'lead-check-refund': 'Refund · numbers we couldn’t check' }
const HOSTED = { 'hosted-sms-setup': 'Business texting setup', 'hosted-sms-renewal': 'Texting plan monthly', 'hosted-sms-text': 'Text sent · Business texting', 'hosted-sms-inbound': 'Text received · Business texting', 'lead-check': 'Lead check', 'cnam-lookup': 'Owner-name lookup', 'caller-id-verify': 'Caller ID verification', 'number-lookup': 'Number lookup', 'email-check': 'Email check', 'fax-number': 'Fax number', 'fax-number-renewal': 'Fax number monthly' }
const LABEL = { purchase: 'Number purchase', purchase_sub: 'Extra number purchase', purchase_verification: 'Number purchase (verification)', renew: 'Number renewal', upgrade: 'Plan upgrade', release: 'Number deleted', sms_reply: 'Extra text' }

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
      ...tx.filter(t => t.type === 'wallet-topup').map(t => ({ id: String(t._id), at: new Date(t.createdAt).toISOString(), type: t.type, description: `${t.metadata?.psp === 'mollie' ? `Card / PayPal top-up${t.metadata?.mode === 'test' ? ' (test)' : ''}` : 'Crypto top-up'} · ${t.metadata?.value || ''} ${t.metadata?.coin || ''}`.trim(), amount: Math.abs(Number(t.amount) || 0) })),
      ...tx.filter(t => HOSTED[t.type]).map(t => ({ id: String(t._id), at: new Date(t.createdAt).toISOString(), type: t.type, description: `${HOSTED[t.type]} · ${t.metadata?.phoneNumber || (t.metadata?.count ? `${t.metadata.count} number${t.metadata.count === 1 ? '' : 's'}` : '')}`, amount: -Math.abs(Number(t.amount) || 0) })),
      ...tx.filter(t => CREDITS[t.type]).map(t => ({ id: String(t._id), at: new Date(t.createdAt).toISOString(), type: t.type, description: `${CREDITS[t.type]}${t.metadata?.phoneNumber && t.type === 'hosted-sms-refund' ? ` · ${t.metadata.phoneNumber}` : ''}${t.type === 'lead-check-refund' ? ` · ${t.metadata?.count} number${t.metadata?.count === 1 ? '' : 's'}` : ''}`, amount: Math.abs(Number(t.amount) || 0) })),
      ...tx.filter(t => t.type === 'card-refund').map(t => ({ id: String(t._id), at: new Date(t.createdAt).toISOString(), type: t.type, description: `Refunded to card · ${t.metadata?.value || ''} ${t.metadata?.coin || ''}`.trim(), amount: -Math.abs(Number(t.amount) || 0) })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 50)
    const wal = await db.collection('walletOf').findOne({ _id: String(id) }, { projection: { usdHeld: 1 } })
    res.json({
      balance: await w.balance(id), held: Math.max(0, Math.round((wal?.usdHeld || 0) * 100) / 100), currency: 'USD', minTopup: MIN_TOPUP_USD, coins, history,
      deposits: deposits.map(d => ({ ref: d.ref, amountUsd: d.amountUsd, coin: d.coin, address: d.address, amountCrypto: d.amountCrypto, createdAt: d.createdAt, expiresAt: d.provider === 'mollie' ? null : expiresAt(d), status: depositStatus(d, paidAt.get(d.ref)), provider: d.provider, ...(d.provider === 'mollie' ? { currency: d.currency, amountCharged: d.amountCharged } : {}) })),
    })
  }))

  // ── Usage report for the current billing cycle ──
  // Aggregates walletLedger (call charges, AI, campaigns) and phoneTransactions (purchases, SMS, fax, lookups)
  // per number, with destination country breakdown.
  router.get('/wallet/usage', h(async (req, res) => {
    const chatId = req.webChatId
    const nums = await db.collection('phoneNumbers').find({ chatId, status: { $ne: 'released' } }).project({ phoneNumber: 1, plan: 1, purchaseDate: 1, expiresAt: 1, type: 1, planPrice: 1 }).toArray()
    // Billing cycle: earliest purchaseDate to latest expiresAt among active numbers, clamped to current month if no numbers.
    const now = new Date()
    let cycleStart, cycleEnd
    if (nums.length) {
      // Use the most recent purchase/renew cycle boundaries
      const starts = nums.map(n => new Date(n.purchaseDate || n.expiresAt || now)).filter(d => !isNaN(d))
      const ends = nums.map(n => new Date(n.expiresAt || now)).filter(d => !isNaN(d))
      cycleStart = starts.length ? new Date(Math.min(...starts)) : new Date(now.getFullYear(), now.getMonth(), 1)
      cycleEnd = ends.length ? new Date(Math.max(...ends)) : now
    } else {
      cycleStart = new Date(now.getFullYear(), now.getMonth(), 1)
      cycleEnd = now
    }

    // Fetch walletLedger entries in the billing cycle (call charges, AI, SIP, campaigns)
    const ledger = await db.collection('walletLedger').find({
      chatId: String(chatId),
      timestamp: { $gte: cycleStart, $lte: cycleEnd },
    }).sort({ timestamp: -1 }).limit(500).toArray()

    // Fetch phoneTransactions in the billing cycle (purchases, renewals, SMS, upgrades, etc.)
    const ptx = await db.collection('phoneTransactions').find({
      chatId,
      timestamp: { $gte: cycleStart.toISOString(), $lte: cycleEnd.toISOString() },
    }).sort({ timestamp: -1 }).limit(200).toArray()

    // Fetch transactions (topups, credits, refunds) in the billing cycle
    const tx = await db.collection('transactions').find({
      chatId: String(chatId),
      createdAt: { $gte: cycleStart, $lte: cycleEnd },
    }).sort({ createdAt: -1 }).limit(100).toArray()

    // Categorize ledger entries
    const callTypes = {
      'AutoRoute_SIPOutbound': 'sip', 'SIPOutbound': 'sip', 'TwilioCall': 'outbound', 'TwilioBridge': 'outbound',
      'Bridge_Transfer': 'forward', 'BulkIVR': 'campaign', 'AIAgent': 'ai_agent', 'AutoRoute_Deferred': 'outbound',
    }
    const summary = { calls: 0, callSpend: 0, aiMinutes: 0, aiSpend: 0, campaignMinutes: 0, campaignSpend: 0, smsCount: 0, smsSpend: 0, faxCount: 0, faxSpend: 0, lookupCount: 0, lookupSpend: 0, totalSpend: 0, connectionFees: 0 }
    const byNumber = {}
    const byCountry = {}
    const details = []

    for (const e of ledger) {
      const amt = Math.abs(e.amount || 0)
      const cat = callTypes[e.callType] || e.type || 'other'
      const phone = e.phoneNumber || 'unknown'
      const dest = e.destination || null

      // Per-number aggregation
      if (!byNumber[phone]) byNumber[phone] = { calls: 0, spend: 0, ai: 0, campaign: 0, sms: 0, fax: 0, lookup: 0 }

      // Country from destination (simple +1=US, +44=UK, etc.)
      let country = null
      if (dest) {
        const cc = dest.replace(/[^0-9+]/g, '')
        if (cc.startsWith('+1')) country = 'US/CA'
        else if (cc.startsWith('+44')) country = 'GB'
        else if (cc.startsWith('+61')) country = 'AU'
        else if (cc.startsWith('+49')) country = 'DE'
        else if (cc.startsWith('+33')) country = 'FR'
        else if (cc.startsWith('+91')) country = 'IN'
        else if (cc.startsWith('+86')) country = 'CN'
        else if (cc.startsWith('+81')) country = 'JP'
        else if (cc.startsWith('+52')) country = 'MX'
        else if (cc.startsWith('+55')) country = 'BR'
        else if (cc.startsWith('+34')) country = 'ES'
        else if (cc.startsWith('+39')) country = 'IT'
        else if (cc.startsWith('+31')) country = 'NL'
        else if (cc.startsWith('+')) country = 'Other'
      }

      if (cat === 'ai_agent') {
        summary.aiSpend += amt; byNumber[phone].ai += amt
        // Estimate minutes from the per-minute charge ($0.10/min for AI receptionist, $0.30/min for AI campaigns)
        if (e.type === 'ai_agent_call') { summary.aiMinutes += amt / 0.30; summary.campaignMinutes += amt / 0.30; summary.campaignSpend += amt; byNumber[phone].campaign += amt }
        else { summary.aiMinutes += amt / 0.10 }
      } else if (cat === 'campaign') {
        summary.campaignMinutes += amt > 0 ? 1 : 0; summary.campaignSpend += amt; byNumber[phone].campaign += amt
      } else if (e.type === 'connection_fee') {
        summary.connectionFees += amt
      } else if (cat === 'sip' || cat === 'outbound' || cat === 'forward') {
        summary.calls += 1; summary.callSpend += amt; byNumber[phone].calls += 1; byNumber[phone].spend += amt
      }

      if (country) {
        if (!byCountry[country]) byCountry[country] = { calls: 0, spend: 0, minutes: 0 }
        byCountry[country].calls += 1; byCountry[country].spend += amt
      }

      details.push({ id: String(e._id), at: e.timestamp, type: e.type || cat, callType: e.callType, phone, destination: dest, country, amount: e.amount, description: e.description })
    }

    // Add phoneTransactions (SMS, fax, lookups, purchases)
    for (const t of ptx) {
      const amt = Math.abs(Number(t.amount) || 0)
      const phone = t.phoneNumber || 'unknown'
      if (!byNumber[phone]) byNumber[phone] = { calls: 0, spend: 0, ai: 0, campaign: 0, sms: 0, fax: 0, lookup: 0 }

      if (t.action === 'sms_reply' || t.action === 'hosted-sms-text') {
        summary.smsCount += 1; summary.smsSpend += amt; byNumber[phone].sms += 1
      } else if (t.action === 'fax-number' || t.action === 'fax-number-renewal') {
        summary.faxCount += 1; summary.faxSpend += amt; byNumber[phone].fax += 1
      }
      details.push({ id: String(t._id), at: t.timestamp, type: t.action, phone, amount: -amt, description: `${LABEL[t.action] || HOSTED[t.action] || t.action} · ${phone}` })
    }

    // Add wallet transactions (lookups, topups, credits)
    for (const t of tx) {
      const amt = Math.abs(Number(t.amount) || 0)
      if (HOSTED[t.type]) {
        if (t.type === 'number-lookup' || t.type === 'cnam-lookup' || t.type === 'email-check') {
          summary.lookupCount += (t.metadata?.count || 1); summary.lookupSpend += amt
        }
        details.push({ id: String(t._id), at: t.createdAt, type: t.type, phone: t.metadata?.phoneNumber || null, amount: -amt, description: `${HOSTED[t.type]}${t.metadata?.phoneNumber ? ` · ${t.metadata.phoneNumber}` : ''}` })
      } else if (CREDITS[t.type]) {
        details.push({ id: String(t._id), at: t.createdAt, type: t.type, phone: null, amount: amt, description: CREDITS[t.type] })
      }
    }

    // Compute combined total spend across all categories
    summary.totalSpend = round2(summary.callSpend + summary.aiSpend + summary.campaignSpend + summary.smsSpend + summary.faxSpend + summary.lookupSpend + summary.connectionFees)

    details.sort((a, b) => String(b.at).localeCompare(String(a.at)))

    res.json({
      cycle: { start: cycleStart.toISOString(), end: cycleEnd.toISOString() },
      numbers: nums.map(n => ({ phone: n.phoneNumber, plan: n.plan, type: n.type, planPrice: n.planPrice, purchaseDate: n.purchaseDate, expiresAt: n.expiresAt })),
      summary: { ...summary, callMinutes: round2(summary.callSpend > 0 ? summary.calls : 0), aiMinutes: round2(summary.aiMinutes), campaignMinutes: round2(summary.campaignMinutes) },
      byNumber: Object.entries(byNumber).map(([phone, d]) => ({ phone, ...d })).sort((a, b) => b.spend - a.spend),
      byCountry: Object.entries(byCountry).map(([country, d]) => ({ country, ...d })).sort((a, b) => b.spend - a.spend),
      details: details.slice(0, 200),
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
