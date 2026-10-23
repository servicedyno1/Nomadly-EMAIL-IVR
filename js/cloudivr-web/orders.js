'use strict'
// Checkout for one number: pay from the wallet, or with crypto for the exact price. A crypto payment lands in the
// wallet first (DynoPay webhook), then the number is bought from it. If the picked number was taken while the
// payment confirmed, a similar one (same country/type/area code, never dearer) is assigned and the owner is told.
const crypto = require('crypto')
const phoneConfig = require('../phone-config')
const notify = require('./notify')
const { walletOps, round2, livePayments } = require('./wallet')

const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const POLL_MS = 30000
const MAX_AGE_MS = 7 * 86400000
const OPEN = ['awaiting_payment', 'underpaid']
const bad = (res, status, error, message) => res.status(status).json({ error, message })

const publicOrder = (o) => ({
  id: o._id, phoneNumber: o.phoneNumber, plan: o.planKey, planName: phoneConfig.plans[o.planKey]?.name || o.planKey, price: o.price,
  coin: o.coin, address: o.address, amountCrypto: o.amountCrypto || null, autoRenew: o.autoRenew !== false, status: o.status,
  paidUsd: o.paidUsd || 0, assignedNumber: o.assignedNumber || null, substitutedFrom: o.substitutedFrom || null,
  message: o.message || null, dryRun: !!o.dryRun, preview: o.provider === 'preview', createdAt: o.createdAt, updatedAt: o.updatedAt,
})

function routes(router, { db, h, numbersApi, coins = [], createCryptoDeposit, sendMail = async () => false, notifyAdmin = () => {}, log = console.log }) {
  const orders = db.collection('webNumberOrders')
  orders.createIndex({ chatId: 1, createdAt: -1 }).catch(() => {})
  orders.createIndex({ status: 1, createdAt: 1 }).catch(() => {})
  const txns = db.collection('transactions')
  const w = walletOps(db)
  const save = (id, fields) => orders.updateOne({ _id: id }, { $set: { ...fields, updatedAt: new Date() } })
  const tell = (o, text, subject) => {
    notify.push(o.chatId, text).catch(() => {})
    if (subject && o.email) sendMail(o.email, subject, `<p>${text}</p><p>— CloudIVR</p>`).catch(e => log(`[CloudIVR-Web] order email failed: ${e.message}`))
  }

  // USD the DynoPay webhook credited for this order's deposit (0 = not paid yet).
  const paidFor = async (o) => {
    const t = await txns.findOne({ chatId: String(o.chatId), type: 'wallet-topup', 'metadata.ref': o._id })
    return t ? round2(t.amount) : 0
  }

  // Same country/type (area code first), never costlier than the picked number.
  async function similar(o) {
    const seen = new Set([o.phoneNumber])
    const out = []
    for (const area of o.areaCode ? [o.areaCode, null] : [null]) {
      for (const n of await numbersApi.searchSimilar(o.country, o.type, area).catch(() => [])) {
        if (!seen.has(n.phoneNumber) && (n.surcharge || 0) <= (o.hit.surcharge || 0)) { seen.add(n.phoneNumber); out.push(n) }
      }
      if (out.length >= 3) break
    }
    return out.slice(0, 3)
  }

  async function activate(o) {
    if ((await w.balance(o.chatId)) < o.price) {
      const short = round2(o.price - (await w.balance(o.chatId)))
      const message = `We received $${(o.paidUsd || 0).toFixed(2)} of $${o.price.toFixed(2)}. It is in your wallet — add $${short.toFixed(2)} more, then press Finish.`
      await save(o._id, { status: 'underpaid', message })
      tell(o, `Your payment for ${o.phoneNumber} came in short. ${message}`)
      return
    }
    const list = [o.hit]
    let loaded = false
    for (let i = 0; i < list.length; i++) {
      const hit = list[i]
      const r = await numbersApi.purchase({ chatId: o.chatId, email: o.email, phone: hit.phoneNumber, planKey: o.planKey, hit, country: o.country, type: o.type, areaCode: o.areaCode, autoRenew: o.autoRenew, viaOrder: o._id })
      if (r.status === 201 || r.status === 202) {
        const assigned = r.status === 201 ? r.body.number.phoneNumber : hit.phoneNumber
        const swapped = assigned !== o.phoneNumber
        const status = r.status === 202 ? 'verification' : 'active'
        const message = swapped
          ? `The number you picked (${o.phoneNumber}) was taken by someone else while your crypto payment was confirming, so we gave you ${assigned} instead — same country${o.areaCode ? ' and area code' : ''}, same price.`
          : `Payment confirmed — ${assigned} is yours.`
        await save(o._id, { status, assignedNumber: assigned, substitutedFrom: swapped ? o.phoneNumber : null, message })
        tell(o, `${message}${status === 'verification' ? ' Open Verification to send the details the carrier needs.' : ''}`, swapped ? `Your new CloudIVR number: ${assigned}` : null)
        if (swapped) notifyAdmin(`🌐 CloudIVR web: crypto order ${o._id} — ${o.phoneNumber} was taken, assigned ${assigned}\nweb account: ${o.chatId} (${o.email})`)
        return
      }
      if (r.status !== 409 && r.status !== 424) {
        await save(o._id, { status: 'failed', message: `${r.body.message} Your payment is in your wallet.` })
        tell(o, `We could not finish your order for ${o.phoneNumber}: ${r.body.message} Your payment is in your CloudIVR wallet.`)
        return
      }
      if (!loaded) { loaded = true; list.push(...await similar(o)) }
    }
    const message = `No number like ${o.phoneNumber} is available right now. Your $${o.price.toFixed(2)} payment is in your wallet — pick another number and pay from your wallet.`
    await save(o._id, { status: 'failed', message })
    tell(o, message, 'Your CloudIVR payment is in your wallet')
  }

  // Claims a paid order exactly once, then buys the number from the wallet.
  async function settle(o) {
    if (!OPEN.includes(o.status)) return
    const paid = o.status === 'underpaid' ? o.paidUsd : await paidFor(o)
    if (!paid) return
    const r = await orders.findOneAndUpdate({ _id: o._id, status: o.status }, { $set: { status: 'activating', paidUsd: paid, updatedAt: new Date() } }, { returnDocument: 'after' })
    const claimed = r && r.value !== undefined ? r.value : r
    if (!claimed) return
    try { await activate(claimed) } catch (e) {
      log(`[CloudIVR-Web] order ${o._id} activation error: ${e.message}`)
      await save(o._id, { status: 'failed', message: 'Something went wrong while activating. Your payment is in your wallet — contact support.' })
    }
  }

  const mine = (req) => orders.findOne({ _id: String(req.params.id), chatId: req.webChatId })

  router.post('/numbers/checkout', h(async (req, res) => {
    const chatId = req.webChatId
    const picked = await numbersApi.pickFromSearch(chatId, req.body.phoneNumber)
    if (!picked) return bad(res, 400, 'search_again', 'That number is no longer in your search results. Search again and pick a number.')
    const planKey = String(req.body.plan || ''), plan = phoneConfig.plans[planKey]
    if (!plan || !phoneConfig.isPlanAvailable(planKey)) return bad(res, 400, 'invalid_plan', 'That plan is not available.')
    const autoRenew = req.body.autoRenew !== false
    if (req.body.method !== 'crypto') {
      const r = await numbersApi.purchase({ chatId, email: req.webUser.email, phone: picked.hit.phoneNumber, planKey, autoRenew, ...picked })
      return res.status(r.status).json(r.body)
    }
    const coin = String(req.body.coin || '')
    if (!coins.includes(coin)) return bad(res, 400, 'invalid_coin', `Pick one of: ${coins.join(', ')}.`)
    const price = round2(plan.price + (picked.hit.surcharge || 0))
    const dep = !livePayments()
      ? { ref: `dry-${crypto.randomUUID().slice(0, 12)}`, address: 'PREVIEW-MODE-DO-NOT-SEND-FUNDS', amountCrypto: null, provider: 'preview' }
      : await createCryptoDeposit(chatId, price, coin)
    if (!dep || !dep.address) return bad(res, 424, 'deposit_unavailable', 'The crypto payment service did not return an address. Try again or pick another coin.')
    const now = new Date()
    const doc = {
      _id: dep.ref, chatId, email: req.webUser.email, phoneNumber: picked.hit.phoneNumber, hit: picked.hit, country: picked.country, type: picked.type,
      areaCode: picked.areaCode, planKey, price, autoRenew, coin, address: dep.address, amountCrypto: dep.amountCrypto || null, provider: dep.provider,
      status: 'awaiting_payment', dryRun: dryRun(), createdAt: now, updatedAt: now,
    }
    await orders.insertOne(doc)
    await db.collection('webDeposits').insertOne({ chatId, ref: dep.ref, amountUsd: price, coin, address: dep.address, amountCrypto: dep.amountCrypto || null, provider: dep.provider, forNumber: doc.phoneNumber, createdAt: now })
    log(`[CloudIVR-Web] crypto order ${dep.ref} ${doc.phoneNumber} $${price} ${coin} for ${chatId}`)
    res.status(201).json({ order: publicOrder(doc) })
  }))

  router.get('/numbers/orders', h(async (req, res) => {
    const q = { chatId: req.webChatId, ...(req.query.open ? { status: { $in: OPEN } } : {}) }
    res.json({ orders: (await orders.find(q).sort({ createdAt: -1 }).limit(10).toArray()).map(publicOrder) })
  }))

  router.get('/numbers/orders/:id', h(async (req, res) => {
    let o = await mine(req)
    if (!o) return bad(res, 404, 'not_found', 'Order not found.')
    if (o.status === 'awaiting_payment') { await settle(o); o = await orders.findOne({ _id: o._id }) }
    res.json({ order: publicOrder(o), balance: await w.balance(req.webChatId) })
  }))

  router.post('/numbers/orders/:id/finish', h(async (req, res) => {
    const o = await mine(req)
    if (!o) return bad(res, 404, 'not_found', 'Order not found.')
    if (o.status !== 'underpaid') return bad(res, 400, 'not_underpaid', 'This order is not waiting for the rest of a payment.')
    const bal = await w.balance(req.webChatId)
    if (bal < o.price) return bad(res, 402, 'insufficient_balance', `Your wallet has $${bal.toFixed(2)} — add $${round2(o.price - bal).toFixed(2)} more to finish.`)
    await settle(o)
    res.json({ order: publicOrder(await orders.findOne({ _id: o._id })), balance: await w.balance(req.webChatId) })
  }))

  router.post('/numbers/orders/:id/cancel', h(async (req, res) => {
    const r = await orders.findOneAndUpdate({ _id: String(req.params.id), chatId: req.webChatId, status: { $in: OPEN } }, { $set: { status: 'cancelled', message: 'Cancelled. Anything you already sent still lands in your wallet.', updatedAt: new Date() } }, { returnDocument: 'after' })
    const o = r && r.value !== undefined ? r.value : r
    if (!o) return bad(res, 400, 'not_open', 'Only an unpaid order can be cancelled.')
    res.json({ order: publicOrder(o) })
  }))

  // Preview only: stands in for the DynoPay webhook so the whole flow can be tried without sending crypto.
  router.post('/numbers/orders/:id/simulate-payment', h(async (req, res) => {
    if (!dryRun()) return bad(res, 404, 'not_found', 'Not available.')
    const o = await mine(req)
    if (!o || o.status !== 'awaiting_payment') return bad(res, 400, 'not_open', 'Only an unpaid order can be paid.')
    const amount = round2(Number(req.body.amountUsd) > 0 ? Math.min(Number(req.body.amountUsd), o.price) : o.price)
    await w.credit(o.chatId, amount)
    await txns.insertOne({ _id: `preview-${o._id}`, chatId: String(o.chatId), type: 'wallet-topup', amount, currency: 'USD', status: 'completed', metadata: { coin: o.coin, value: 'preview', ref: o._id, psp: 'preview' }, createdAt: new Date(), updatedAt: new Date() })
    await settle(o)
    res.json({ order: publicOrder(await orders.findOne({ _id: o._id })), balance: await w.balance(req.webChatId) })
  }))

  // Background: pick up confirmed crypto payments even when nobody has the order page open.
  const tick = async () => {
    const due = await orders.find({ status: 'awaiting_payment', createdAt: { $gt: new Date(Date.now() - MAX_AGE_MS) } }).limit(50).toArray()
    for (const o of due) await settle(o).catch(e => log(`[CloudIVR-Web] order poll ${o._id}: ${e.message}`))
  }
  const timer = setInterval(() => { tick().catch(() => {}) }, POLL_MS)
  if (timer.unref) timer.unref()
  return { settle, tick }
}

module.exports = { routes, publicOrder }
