'use strict'
// Checkout for one number: pay from the wallet, or with crypto for the exact price. A crypto payment lands in the
// wallet first (DynoPay webhook), then the number is bought from it. If the picked number was taken while the
// payment confirmed, a similar one (same country/type/area code, never dearer) is assigned and the owner is told.
const crypto = require('crypto')
const phoneConfig = require('../phone-config')
const notify = require('./notify')
const { walletOps, round2, livePayments, MIN_TOPUP_USD } = require('./wallet')

const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const POLL_MS = 30000
const MAX_AGE_MS = 7 * 86400000
const OPEN = ['awaiting_payment', 'underpaid']
const { PAY_WINDOW_MS } = require('./wallet')
const bad = (res, status, error, message, extra) => res.status(status).json({ error, message, ...extra })
const ES = () => require('../spenza.js')
// Texting Number bought with the Business Line in one checkout (first month at the bundle price).
async function textingAddOn(body) {
  if (!body.texting) return null
  const zip = String(body.texting.zipcode || '').trim()
  if (!/^\d{5}$/.test(zip)) return { error: 'Enter a 5-digit USA ZIP code for the Texting Number.' }
  const offer = await ES().mobileOffer()
  if (!offer.available) return { error: 'Texting Numbers are temporarily unavailable. Buy the Business Line on its own and add one later.' }
  return { zipcode: zip, charge: offer.bundlePrice }
}

// USD the wallet must hold to finish the order (extras/upgrades may deposit more than they cost: crypto minimum).
const needOf = (o) => o.need != null ? o.need : (o.kind === 'extra' || o.kind === 'upgrade') ? (o.charge || o.price) : o.price

const publicOrder = (o) => ({
  id: o._id, kind: o.kind || 'number', charge: o.charge || o.price, phoneNumber: o.phoneNumber, plan: o.planKey, planName: phoneConfig.plans[o.planKey]?.name || o.planKey, price: o.price,
  parentNumber: o.parentNumber || null, count: o.items ? o.items.length : 1, numbers: o.items ? o.items.map(i => i.phoneNumber) : [o.phoneNumber], added: o.added || null, failed: o.failed || null, texting: o.texting ? { charge: o.texting.charge, line: o.textingLine || null } : null,
  coin: o.coin, address: o.address, amountCrypto: o.amountCrypto || null, autoRenew: o.autoRenew !== false, status: o.status,
  paidUsd: o.paidUsd || 0, walletPart: o.walletPart || 0, total: needOf(o), assignedNumber: o.assignedNumber || null, substitutedFrom: o.substitutedFrom || null,
  message: o.message || null, dryRun: !!o.dryRun, preview: o.provider === 'preview', createdAt: o.createdAt, updatedAt: o.updatedAt,
  // Still awaiting_payment in the DB so a late payment is picked up (see tick); shown as expired after the window.
  expiresAt: new Date(new Date(o.createdAt).getTime() + PAY_WINDOW_MS), expired: o.status === 'awaiting_payment' && Date.now() > new Date(o.createdAt).getTime() + PAY_WINDOW_MS,
})

function routes(router, { db, h, numbersApi, offers = null, coins = [], createCryptoDeposit, sendMail = async () => false, notifyAdmin = () => {}, log = console.log }) {
  const orders = db.collection('webNumberOrders')
  orders.createIndex({ chatId: 1, createdAt: -1 }).catch(() => {})
  orders.createIndex({ status: 1, createdAt: 1 }).catch(() => {})
  const txns = db.collection('transactions')
  const w = walletOps(db)
  const save = (id, fields) => orders.updateOne({ _id: id }, { $set: { ...fields, updatedAt: new Date() } })
  const tell = (o, text, subject) => {
    notify.push(o.chatId, text).catch(() => {})
    if (subject && o.email) sendMail(o.email, subject, `<p>${text}</p>`).catch(e => log(`[CloudIVR-Web] order email failed: ${e.message}`))
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

  // Paid plan upgrade: the crypto landed in the wallet, now move the number up from it.
  async function activateUpgrade(o) {
    const n = await numbersApi.findMine(o.chatId, o.phoneNumber)
    const planName = phoneConfig.plans[o.planKey]?.name || o.planKey
    if (!n) { await save(o._id, { status: 'failed', message: `${o.phoneNumber} is no longer on your account. Your payment is in your wallet.` }); return }
    const r = await numbersApi.upgradeNumber(o.chatId, n, o.planKey, o._id, o.offerPct || 0)
    if (r.status === 200 && o.offerId && offers) await offers.markUsed(o.offerId).catch(() => {})
    if (r.status === 200) {
      const message = `Payment confirmed — ${o.phoneNumber} is now on the ${planName} plan.${o.price + (o.walletPart || 0) > r.body.charged ? ` The $${round2(o.price + (o.walletPart || 0) - r.body.charged).toFixed(2)} left over stays in your wallet.` : ''}`
      await save(o._id, { status: 'active', assignedNumber: o.phoneNumber, chargedUsd: r.body.charged, message })
      tell(o, message, `${o.phoneNumber} upgraded to ${planName}`)
      return
    }
    if (r.status === 402) {
      const message = `${r.body.message} Nothing was charged — everything is in your wallet. Start the upgrade again any time.`
      await save(o._id, { status: 'failed', message })
      tell(o, `Your upgrade payment for ${o.phoneNumber} came in short. ${message}`, 'Your CloudIVR payment is in your wallet')
      return
    }
    await save(o._id, { status: 'failed', message: `${r.body.message} Your payment is in your wallet.` })
    tell(o, `We could not upgrade ${o.phoneNumber}: ${r.body.message} Your payment is in your CloudIVR wallet.`)
  }

  // Extra number on a plan: re-check the main number (still yours, active, room left) when the payment lands.
  async function extraParent(o) {
    const parent = await numbersApi.findMine(o.chatId, o.parentNumber)
    if (!parent || parent.isSubNumber) return { error: `${o.parentNumber} is no longer on your account, so the extra number was not added.` }
    if (parent.status !== 'active') return { error: `${o.parentNumber} is not active, so the extra number was not added.` }
    const used = (await numbersApi.myNumbers(o.chatId)).filter(n => n.isSubNumber && n.parentNumber === parent.phoneNumber).length
    const limit = phoneConfig.getSubNumberLimit(parent.plan)
    if (used >= limit) return { error: `${o.parentNumber} already has ${limit} extra numbers — the most its plan allows.` }
    return { parent }
  }

  // Several extra numbers paid in one crypto order: add each from the wallet; any that can't be added stay paid-for in the wallet.
  async function activateExtras(o) {
    const p = await extraParent(o)
    if (p.error) {
      const message = `${p.error} Your payment is in your wallet.`
      await save(o._id, { status: 'failed', message })
      tell(o, `We could not add your extra numbers: ${message}`, 'Your CloudIVR payment is in your wallet')
      return
    }
    const parent = p.parent
    let left = phoneConfig.subSlotsLeft(parent.plan, (await numbersApi.myNumbers(o.chatId)).filter(n => n.isSubNumber && n.parentNumber === parent.phoneNumber).length)
    const added = [], failed = []
    let redeemed = false
    for (const it of o.items) {
      if (!left) { failed.push({ phoneNumber: it.phoneNumber, message: 'the plan has no free extra-number slot left' }); continue }
      if (it.mtMeta) require('../multitel').remember(it.phoneNumber, it.mtMeta)
      const r = await numbersApi.purchase({ chatId: o.chatId, email: o.email, phone: it.phoneNumber, planKey: parent.plan, hit: it.hit, country: it.country, type: it.type, areaCode: it.areaCode, autoRenew: o.autoRenew, coupon: o.coupon || null, skipRedeem: redeemed, viaOrder: o._id, sub: { parentNumber: parent.phoneNumber, plan: parent.plan } })
      if (r.status === 201 || r.status === 202) { added.push(r.body.number?.phoneNumber || it.phoneNumber); left--; redeemed = true } else failed.push({ phoneNumber: it.phoneNumber, message: r.body.message })
    }
    const { extraSummary } = require('./extras')
    const message = `${added.length ? 'Payment confirmed — ' : ''}${extraSummary(parent.phoneNumber, added, failed)}`
    await save(o._id, { status: added.length ? 'active' : 'failed', assignedNumber: added[0] || null, added, failed, message })
    tell(o, message, added.length ? `${added.length} extra number${added.length === 1 ? '' : 's'} added` : 'Your CloudIVR payment is in your wallet')
  }

  async function activate(o) {
    if (o.kind === 'upgrade') return activateUpgrade(o)
    if (o.kind === 'extra' && o.items?.length) return activateExtras(o)
    const extra = o.kind === 'extra'
    let sub = null
    if (extra) {
      const p = await extraParent(o)
      if (p.error) {
        const message = `${p.error} Your payment is in your wallet.`
        await save(o._id, { status: 'failed', message })
        tell(o, `We could not add the extra number ${o.phoneNumber}: ${message}`, 'Your CloudIVR payment is in your wallet')
        return
      }
      sub = { parentNumber: p.parent.phoneNumber, plan: p.parent.plan }
    }
    // The number's buy details from the search (in memory only — a restart while the crypto payment arrives loses them).
    if (o.mtMeta) require('../multitel').remember(o.phoneNumber, o.mtMeta)
    const need = needOf(o)
    if ((await w.balance(o.chatId)) < need) {
      const message = `We received $${(o.paidUsd || 0).toFixed(2)} but ${o.phoneNumber} needs $${need.toFixed(2)}${o.walletPart ? ` (with $${o.walletPart.toFixed(2)} from your wallet)` : ''}. Nothing was bought — everything is in your wallet. Start the purchase again any time.`
      await save(o._id, { status: 'failed', message })
      tell(o, `Your payment for ${o.phoneNumber} came in short. ${message}`, 'Your CloudIVR payment is in your wallet')
      return
    }
    const list = [o.hit]
    let loaded = false
    for (let i = 0; i < list.length; i++) {
      const hit = list[i]
      const r = await numbersApi.purchase({ chatId: o.chatId, email: o.email, phone: hit.phoneNumber, planKey: sub ? sub.plan : o.planKey, hit, country: o.country, type: o.type, areaCode: o.areaCode, autoRenew: o.autoRenew, coupon: o.coupon || null, viaOrder: o._id, sub, withTexting: o.withTexting === true })
      if (r.status === 201 || r.status === 202) {
        const assigned = r.status === 201 ? r.body.number.phoneNumber : hit.phoneNumber
        const swapped = assigned !== o.phoneNumber && String(o.phoneNumber).replace(/\D/g, '').length >= 9 // a short prefix = number assigned at order
        const status = r.status === 202 ? 'verification' : 'active'
        const charged = extra ? round2(o.charge) : round2(phoneConfig.plans[o.planKey].price + phoneConfig.planAddon(o.planKey, o.country, o.type, hit.surcharge || 0))
        const linePaid = round2(needOf(o) - (o.texting?.charge || 0))
        const priceNote = charged < linePaid ? `it costs $${charged.toFixed(2)}, so the $${round2(linePaid - charged).toFixed(2)} difference stays in your wallet` : 'same price'
        const leftover = extra && o.price + (o.walletPart || 0) > charged ? ` The $${round2(o.price + (o.walletPart || 0) - charged).toFixed(2)} left over stays in your wallet.` : ''
        const message = swapped
          ? `The number you picked (${o.phoneNumber}) was taken while your payment was confirming, so we gave you ${assigned} instead — same country${o.areaCode ? ' and area code' : ''}, ${extra ? `same price.${leftover}` : priceNote}${extra ? '' : '.'}`
          : extra ? `Payment confirmed — ${assigned} is now an extra number on ${sub.parentNumber}.${leftover}` : `Payment confirmed — ${assigned} is yours.`
        const tx = o.texting ? await ES().buyMobile(o.chatId, { zipcode: o.texting.zipcode, autoRenew: o.autoRenew, charge: o.texting.charge }).catch(e => ({ error: e.message })) : null
        const txNote = !tx ? '' : tx.error ? ` Your Texting Number couldn’t be ordered: ${tx.error}` : ' Your Texting Number is being set up — we’ll tell you when it’s ready.'
        await save(o._id, { status, assignedNumber: assigned, substitutedFrom: swapped ? o.phoneNumber : null, chargedUsd: round2(charged + (tx && !tx.error ? o.texting.charge : 0)), message: message + txNote, ...(tx ? { textingLine: tx.item?.id || null } : {}) })
        tell(o, `${message}${txNote}${status === 'verification' ? ' Open Verification to send the details the carrier needs.' : ''}`, swapped ? `Your new CloudIVR number: ${assigned}` : null)
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
  // useWallet: what's in the wallet now pays part of `total`; crypto covers the rest (at least the minimum top-up).
  const split = async (chatId, total, useWallet) => {
    const bal = useWallet ? Math.max(0, await w.balance(chatId)) : 0
    const walletPart = round2(Math.min(bal, total))
    return { walletPart, deposit: round2(Math.max(total - walletPart, MIN_TOPUP_USD)) }
  }

  router.post('/numbers/checkout', h(async (req, res) => {
    const chatId = req.webChatId
    const picked = await numbersApi.pickFromSearch(chatId, req.body.phoneNumber)
    if (!picked) return bad(res, 400, 'search_again', 'That number is no longer in your search results. Search again and pick a number.')
    const planKey = String(req.body.plan || ''), plan = phoneConfig.plans[planKey]
    if (!plan || !phoneConfig.isPlanAvailable(planKey)) return bad(res, 400, 'invalid_plan', 'That plan is not available.')
    const textOffer = req.body.withTexting === true && !!require('../texting-countries').offerOf(picked.country, picked.type)
    const incl = phoneConfig.planNumberIssue(picked.country, picked.type)
    if (incl) return bad(res, 400, 'extra_number_only', incl)
    const autoRenew = req.body.autoRenew !== false
    let coupon = null
    if (req.body.coupon) {
      coupon = await numbersApi.checkCoupon(chatId, req.body.coupon)
      if (coupon.error) return bad(res, 400, 'invalid_coupon', coupon.message)
    }
    const texting = await textingAddOn(req.body)
    if (texting?.error) return bad(res, 400, 'texting_unavailable', texting.error)
    const linePrice = round2((plan.price + phoneConfig.planAddon(planKey, picked.country, picked.type, picked.hit.surcharge || 0)) * (1 - (coupon ? coupon.discount : 0) / 100))
    if (req.body.method !== 'crypto') {
      if (texting) {
        const bal = await w.balance(chatId), need = round2(linePrice + texting.charge)
        if (bal < need) return bad(res, 402, 'insufficient_balance', `The Business Line and the Texting Number come to $${need.toFixed(2)}. Your wallet has $${bal.toFixed(2)}.`, { cost: need, need: round2(need - bal) })
      }
      const r = await numbersApi.purchase({ chatId, email: req.webUser.email, phone: picked.hit.phoneNumber, planKey, autoRenew, coupon, withTexting: req.body.withTexting === true, ...picked })
      if (texting && (r.status === 201 || r.status === 202)) r.body.texting = await ES().buyMobile(chatId, { zipcode: texting.zipcode, autoRenew, charge: texting.charge }).catch(e => ({ error: e.message }))
      return res.status(r.status).json(r.body)
    }
    const coin = String(req.body.coin || '')
    if (!coins.includes(coin)) return bad(res, 400, 'invalid_coin', `Pick one of: ${coins.join(', ')}.`)
    const total = round2(linePrice + (texting ? texting.charge : 0))
    const { walletPart, deposit: price } = await split(chatId, total, req.body.useWallet === true)
    const dep = !livePayments()
      ? { ref: `dry-${crypto.randomUUID().slice(0, 12)}`, address: 'PREVIEW-MODE-DO-NOT-SEND-FUNDS', amountCrypto: null, provider: 'preview' }
      : await createCryptoDeposit(chatId, price, coin)
    if (!dep || !dep.address) return bad(res, 424, 'deposit_unavailable', 'The crypto payment service did not return an address. Try again or pick another coin.')
    const now = new Date()
    const doc = {
      _id: dep.ref, chatId, email: req.webUser.email, phoneNumber: picked.hit.phoneNumber, hit: picked.hit, mtMeta: require('../multitel').searchedMeta(picked.hit.phoneNumber), country: picked.country, type: picked.type,
      areaCode: picked.areaCode, planKey, price, need: total, walletPart, autoRenew, coupon, coin, ...(texting ? { texting } : {}), ...(textOffer ? { withTexting: true } : {}), address: dep.address, amountCrypto: dep.amountCrypto || null, provider: dep.provider,
      status: 'awaiting_payment', dryRun: dryRun(), createdAt: now, updatedAt: now,
    }
    await orders.insertOne(doc)
    await db.collection('webDeposits').insertOne({ chatId, ref: dep.ref, amountUsd: price, coin, address: dep.address, amountCrypto: dep.amountCrypto || null, provider: dep.provider, forNumber: doc.phoneNumber, createdAt: now })
    log(`[CloudIVR-Web] crypto order ${dep.ref} ${doc.phoneNumber} $${price} ${coin} for ${chatId}`)
    res.status(201).json({ order: publicOrder(doc) })
  }))

  // Crypto for a plan upgrade: a deposit for the upgrade price (at least the minimum top-up; any extra stays in the wallet).
  router.post('/numbers/:phone/upgrade-checkout', h(async (req, res) => {
    const chatId = req.webChatId
    const n = await numbersApi.findMine(chatId, req.params.phone)
    if (!n) return bad(res, 404, 'not_found', 'Number not found on your account.')
    const planKey = String(req.body.plan || '')
    const offer = await numbersApi.upgradeOffer(chatId, n, planKey)
    const q = numbersApi.upgradeQuote(n, planKey, offer?.discount || 0)
    if (q.error) return bad(res, q.error.status, q.error.error, q.error.message)
    const coin = String(req.body.coin || '')
    if (!coins.includes(coin)) return bad(res, 400, 'invalid_coin', `Pick one of: ${coins.join(', ')}.`)
    const { walletPart, deposit: price } = await split(chatId, q.charge, req.body.useWallet === true)
    const dep = !livePayments()
      ? { ref: `dry-${crypto.randomUUID().slice(0, 12)}`, address: 'PREVIEW-MODE-DO-NOT-SEND-FUNDS', amountCrypto: null, provider: 'preview' }
      : await createCryptoDeposit(chatId, price, coin)
    if (!dep || !dep.address) return bad(res, 424, 'deposit_unavailable', 'The crypto payment service did not return an address. Try again or pick another coin.')
    const now = new Date()
    const doc = { _id: dep.ref, kind: 'upgrade', chatId, email: req.webUser.email, phoneNumber: n.phoneNumber, planKey, price, charge: q.charge, walletPart, offerPct: offer?.discount || 0, offerId: offer?._id || null, autoRenew: n.autoRenew !== false, coin, address: dep.address, amountCrypto: dep.amountCrypto || null, provider: dep.provider, status: 'awaiting_payment', dryRun: dryRun(), createdAt: now, updatedAt: now }
    await orders.insertOne(doc)
    await db.collection('webDeposits').insertOne({ chatId, ref: dep.ref, amountUsd: price, coin, address: dep.address, amountCrypto: dep.amountCrypto || null, provider: dep.provider, forNumber: n.phoneNumber, forUpgrade: planKey, createdAt: now })
    log(`[CloudIVR-Web] crypto upgrade ${dep.ref} ${n.phoneNumber} → ${planKey} $${price} ${coin} for ${chatId}`)
    res.status(201).json({ order: publicOrder(doc) })
  }))

  // Crypto for an extra number on a plan: flat extra-number price (coupon off), deposit at least the minimum
  // top-up — anything over the price stays in the wallet. The number is added once the payment confirms.
  router.post('/numbers/:phone/extra-checkout', h(async (req, res) => {
    const chatId = req.webChatId
    const n = await numbersApi.findMine(chatId, req.params.phone)
    if (!n) return bad(res, 404, 'not_found', 'Number not found on your account.')
    if (n.isSubNumber) return bad(res, 400, 'is_extra', 'This is already an extra number. Add extras from its main number.')
    if (n.status !== 'active') return bad(res, 400, 'not_active', 'The main number must be active to add extra numbers.')
    const { extraPicks } = require('./extras')
    const phones = extraPicks(req.body)
    if (!phones.length) return bad(res, 400, 'pick_number', 'Pick at least one number.')
    const used = (await numbersApi.myNumbers(chatId)).filter(x => x.isSubNumber && x.parentNumber === n.phoneNumber).length
    const left = phoneConfig.subSlotsLeft(n.plan, used)
    const planName = phoneConfig.plans[n.plan]?.name || n.plan
    if (!left) return bad(res, 400, 'limit_reached', `The ${planName} plan allows ${phoneConfig.getSubNumberLimit(n.plan)} extra numbers. Upgrade the main number to add more.`)
    if (phones.length > left) return bad(res, 400, 'too_many', `The ${planName} plan has room for ${left} more extra number${left === 1 ? '' : 's'}. Untick ${phones.length - left} and try again.`)
    const picks = await numbersApi.pickManyFromSearch(chatId, phones)
    if (!picks) return bad(res, 400, 'search_again', 'A number you picked is no longer in your search results. Search again and pick your numbers.')
    const picked = picks[0]
    let coupon = null
    if (req.body.coupon) {
      coupon = await numbersApi.checkCoupon(chatId, req.body.coupon)
      if (coupon.error) return bad(res, 400, 'invalid_coupon', coupon.message)
    }
    const coin = String(req.body.coin || '')
    if (!coins.includes(coin)) return bad(res, 400, 'invalid_coin', `Pick one of: ${coins.join(', ')}.`)
    const ratio = new Date(n.expiresAt) > new Date() ? require('../plan-lifecycle').prorateRatio(n.expiresAt) : 1
    const each = (p) => round2(Math.max(0.5, numbersApi.extraPriceOf(p.country, p.type) * ratio) * (1 - (coupon ? coupon.discount : 0) / 100))
    const charge = round2(picks.reduce((t, p) => t + each(p), 0))
    const items = picks.length > 1 ? picks.map(p => ({ phoneNumber: p.hit.phoneNumber, hit: p.hit, mtMeta: require('../multitel').searchedMeta(p.hit.phoneNumber), country: p.country, type: p.type, areaCode: p.areaCode, charge: each(p) })) : null
    const { walletPart, deposit: price } = await split(chatId, charge, req.body.useWallet === true)
    const dep = !livePayments()
      ? { ref: `dry-${crypto.randomUUID().slice(0, 12)}`, address: 'PREVIEW-MODE-DO-NOT-SEND-FUNDS', amountCrypto: null, provider: 'preview' }
      : await createCryptoDeposit(chatId, price, coin)
    if (!dep || !dep.address) return bad(res, 424, 'deposit_unavailable', 'The crypto payment service did not return an address. Try again or pick another coin.')
    const now = new Date()
    const doc = {
      _id: dep.ref, kind: 'extra', chatId, email: req.webUser.email, phoneNumber: picked.hit.phoneNumber, parentNumber: n.phoneNumber, hit: picked.hit, mtMeta: require('../multitel').searchedMeta(picked.hit.phoneNumber),
      country: picked.country, type: picked.type, areaCode: picked.areaCode, planKey: n.plan, price, charge, walletPart, ...(items ? { items } : {}), autoRenew: req.body.autoRenew !== false, coupon, coin,
      address: dep.address, amountCrypto: dep.amountCrypto || null, provider: dep.provider, status: 'awaiting_payment', dryRun: dryRun(), createdAt: now, updatedAt: now,
    }
    await orders.insertOne(doc)
    await db.collection('webDeposits').insertOne({ chatId, ref: dep.ref, amountUsd: price, coin, address: dep.address, amountCrypto: dep.amountCrypto || null, provider: dep.provider, forNumber: doc.phoneNumber, forExtraOn: n.phoneNumber, createdAt: now })
    log(`[CloudIVR-Web] crypto extra-number order ${dep.ref} ${items ? `${items.length} numbers` : doc.phoneNumber} on ${n.phoneNumber} $${price} ${coin} for ${chatId}`)
    res.status(201).json({ order: publicOrder(doc) })
  }))

  router.get('/numbers/orders', h(async (req, res) => {
    const fresh = { $or: [{ status: 'underpaid' }, { status: 'awaiting_payment', createdAt: { $gt: new Date(Date.now() - PAY_WINDOW_MS) } }] }
    const q = { chatId: req.webChatId, ...(req.query.open ? fresh : {}) }
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
    if (o.kind !== 'upgrade' && bal < needOf(o)) return bad(res, 402, 'insufficient_balance', `This order comes to $${needOf(o).toFixed(2)}. Your wallet has $${bal.toFixed(2)}.`, { cost: needOf(o), need: round2(needOf(o) - bal) })
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
