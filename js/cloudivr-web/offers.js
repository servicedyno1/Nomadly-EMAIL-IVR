'use strict'
// Personal daily offer for each web account: the one that fits them best today (renewal due, no number yet,
// never topped up, room to upgrade, or a top-up bonus). One offer per account per UTC day; dismissible; still
// applied at checkout (number code, renewal, upgrade) or on the payment (top-up bonuses) while it lasts.
const crypto = require('crypto')
const { walletOps, round2 } = require('./wallet')

const TIERS = [{ min: 50, bonus: 5 }, { min: 100, bonus: 15 }, { min: 250, bonus: 50 }]
const FIRST = { min: 25, pct: 20, max: 50 }
const NUMBER_PCTS = [10, 15, 20]
const RENEW_PCT = 15
const UPGRADE_PCT = 20
const RENEW_WINDOW_MS = 7 * 86400000
const NEXT_PLAN = { starter: 'pro', pro: 'business' }
const PLAN_NAME = { starter: 'Starter', pro: 'Pro', business: 'Business' }
const usd = (n) => `$${Number(n).toFixed(Number(n) % 1 ? 2 : 0)}`

const today = () => new Date().toISOString().slice(0, 10)
const endOfDay = () => { const d = new Date(); d.setUTCHours(23, 59, 59, 0); return d }
const dayNum = () => Math.floor(Date.now() / 86400000)
const hashPick = (id, list) => list[(dayNum() + (parseInt(crypto.createHash('md5').update(String(id)).digest('hex').slice(0, 6), 16) || 0)) % list.length]

function tierBonus(amount) {
  let b = 0
  for (const t of TIERS) if (amount >= t.min) b = t.bonus
  return b
}

// Words + link the app shows for an offer.
function present(o) {
  const enc = encodeURIComponent
  if (o.kind === 'number') return { title: `${o.discount}% off a new number`, text: `Use code ${o.code} at checkout — works on a new number or an extra number.`, cta: { label: 'Use it', to: `/app/buy?coupon=${enc(o.code)}` } }
  if (o.kind === 'renew') return { title: `${o.discount}% off your renewal`, text: `${o.phones[0]}${o.phones.length > 1 ? ` and ${o.phones.length - 1} more` : ''} ${o.phones.length > 1 ? 'renew' : 'renews'} soon. Renew today from the Billing tab and pay ${o.discount}% less.`, cta: { label: 'Renew now', to: `/app/numbers/${enc(o.phones[0])}?tab=billing` } }
  if (o.kind === 'upgrade') return { title: `${o.discount}% off a plan upgrade`, text: `Move ${o.phone} from ${PLAN_NAME[o.from]} to ${PLAN_NAME[o.to]} today and pay ${o.discount}% less.`, cta: { label: 'See the upgrade', to: `/app/numbers/${enc(o.phone)}?tab=billing&plan=${o.to}` } }
  if (o.kind === 'firstTopup') return { title: `First top-up bonus: +${FIRST.pct}%`, text: `Top up ${usd(FIRST.min)} or more for the first time and get ${FIRST.pct}% extra credit (up to ${usd(FIRST.max)}).`, cta: { label: 'Top up', to: '/app/wallet' } }
  return { title: 'Top up $100, get $115', text: `${TIERS.map(t => `${usd(t.min)} → ${usd(t.min + t.bonus)}`).join(' · ')}. One bonus per day — it lands in your wallet when the payment confirms.`, cta: { label: 'Top up', to: '/app/wallet?amount=100' } }
}

const publicOffer = (o) => ({
  id: o._id, kind: o.kind, discount: o.discount || null, code: o.code || null, phones: o.phones || null, phone: o.phone || null, plan: o.to || null,
  tiers: o.kind === 'topup' ? TIERS : null, first: o.kind === 'firstTopup' ? FIRST : null,
  dismissed: !!o.dismissed, used: !!o.used, expiresAt: o.expiresAt, ...present(o),
})

function createOffers(db, { log = console.log } = {}) {
  const offers = db.collection('webOffers')
  offers.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 }).catch(() => {})
  offers.createIndex({ code: 1 }, { sparse: true }).catch(() => {})
  const deposits = db.collection('webDeposits')
  const txns = db.collection('transactions')
  const w = walletOps(db)

  async function choose(chatId) {
    const nums = ((await db.collection('phoneNumbersOf').findOne({ _id: chatId }))?.val?.numbers || []).filter(n => n.status !== 'released')
    const now = Date.now()
    const due = nums.filter(n => !n.isSubNumber && n.expiresAt && (n.status === 'suspended' || new Date(n.expiresAt).getTime() - now < RENEW_WINDOW_MS))
    if (due.length) return { kind: 'renew', discount: RENEW_PCT, phones: due.map(n => n.phoneNumber) }
    const number = () => ({ kind: 'number', discount: hashPick(chatId, NUMBER_PCTS), code: `CIVR${crypto.randomBytes(3).toString('hex').toUpperCase()}` })
    if (!nums.length) return number()
    if (!(await txns.findOne({ chatId: String(chatId), type: 'wallet-topup' }, { projection: { _id: 1 } }))) return { kind: 'firstTopup' }
    const up = nums.find(n => !n.isSubNumber && n.status === 'active' && NEXT_PLAN[n.plan])
    const rotate = dayNum() % 2 === 0
    if (up) return rotate ? { kind: 'upgrade', discount: UPGRADE_PCT, phone: up.phoneNumber, from: up.plan, to: NEXT_PLAN[up.plan] } : { kind: 'topup' }
    return rotate ? { kind: 'topup' } : number()
  }

  // Today's offer for this account (made on first ask).
  async function current(chatId) {
    const id = `${today()}:${chatId}`
    const have = await offers.findOne({ _id: id })
    if (have) return have
    const doc = { _id: id, chatId: String(chatId), day: today(), ...(await choose(String(chatId))), dismissed: false, used: false, expiresAt: endOfDay(), createdAt: new Date() }
    try { await offers.insertOne(doc) } catch (e) { if (e.code === 11000) return offers.findOne({ _id: id }); throw e }
    return doc
  }
  const live = async (chatId, kind) => {
    const o = await current(chatId)
    return o.kind === kind && !o.used && new Date(o.expiresAt) > new Date() ? o : null
  }

  // Number code → coupon { code, type: 'web-offer', discount } (only for its owner, today, unused).
  async function checkCode(chatId, code) {
    if (!/^CIVR[0-9A-F]{6}$/.test(code)) return null
    const o = await offers.findOne({ code, chatId: String(chatId) })
    if (!o) return null
    if (o.used) return { error: 'already_used' }
    if (new Date(o.expiresAt) <= new Date()) return { error: 'expired' }
    return { code, type: 'web-offer', discount: o.discount }
  }
  const markUsed = (id) => offers.updateOne({ _id: id }, { $set: { used: true, usedAt: new Date() } })
  const markCodeUsed = (chatId, code) => offers.updateOne({ code, chatId: String(chatId) }, { $set: { used: true, usedAt: new Date() } })

  const renewOffer = async (chatId, phone) => { const o = await live(chatId, 'renew'); return o && o.phones.includes(phone) ? o : null }
  const upgradeOffer = async (chatId, phone, plan) => { const o = await live(chatId, 'upgrade'); return o && o.phone === phone && (!plan || plan === o.to) ? o : null }

  // Snapshot stored on a wallet top-up deposit; paid out when the deposit is credited.
  async function topupBonusFor(chatId) {
    const o = await current(chatId)
    if (o.used || new Date(o.expiresAt) <= new Date()) return null
    if (o.kind === 'topup') return { offerId: o._id, kind: 'topup', tiers: TIERS }
    if (o.kind === 'firstTopup') return { offerId: o._id, kind: 'firstTopup', ...FIRST }
    return null
  }
  const bonusOf = (b, amount) => (b.kind === 'topup' ? tierBonus(amount) : amount >= b.min ? round2(Math.min(b.max, amount * b.pct / 100)) : 0)

  async function payBonuses(push) {
    const open = await deposits.find({ bonus: { $ne: null }, bonusPaidAt: null, createdAt: { $gt: new Date(Date.now() - 7 * 86400000) } }).limit(100).toArray()
    for (const d of open) {
      const t = await txns.findOne({ chatId: String(d.chatId), type: 'wallet-topup', 'metadata.ref': d.ref })
      if (!t) continue
      const amount = round2(t.amount)
      let bonus = bonusOf(d.bonus, amount)
      // One bonus per offer: claim the offer first, so several open deposits can't each be paid.
      if (bonus > 0 && (await offers.updateOne({ _id: d.bonus.offerId, used: false }, { $set: { used: true, usedAt: new Date() } })).modifiedCount !== 1) bonus = 0
      const r = await deposits.updateOne({ _id: d._id, bonusPaidAt: null }, { $set: { bonusPaidAt: new Date(), bonusUsd: bonus } })
      if (r.modifiedCount !== 1 || !(bonus > 0)) continue
      await w.credit(d.chatId, bonus)
      await txns.insertOne({ chatId: String(d.chatId), type: 'topup-bonus', amount: bonus, currency: 'USD', status: 'completed', metadata: { ref: d.ref, offer: d.bonus.offerId, paid: amount }, createdAt: new Date(), updatedAt: new Date() })
      await push(String(d.chatId), `Top-up bonus: ${usd(bonus)} extra credit was added to your wallet for your ${usd(amount)} top-up.`).catch(() => {})
      log(`[CloudIVR-Web] top-up bonus $${bonus} for ${d.chatId} (deposit ${d.ref}, paid $${amount})`)
    }
  }

  function routes(router, { h }) {
    router.get('/offers/current', h(async (req, res) => res.json({ offer: publicOffer(await current(req.webChatId)) })))
    router.post('/offers/dismiss', h(async (req, res) => {
      const o = await current(req.webChatId)
      await offers.updateOne({ _id: o._id }, { $set: { dismissed: true } })
      res.json({ offer: publicOffer({ ...o, dismissed: true }) })
    }))
  }

  return { current, checkCode, markUsed, markCodeUsed, renewOffer, upgradeOffer, topupBonusFor, payBonuses, routes, present, publicOffer }
}

module.exports = { createOffers, tierBonus, TIERS, FIRST, present }
