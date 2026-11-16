'use strict'
// Cardholder ID check: the first card / Apple Pay / Google Pay top-up of an account is credited but held (not spendable)
// until a Stripe Identity check shows the ID name matches the card name. Clear match → released; doubtful → admin
// review; mismatch, repeated failure or no check within the deadline → the card payment is refunded. Once per account.
const round4 = (n) => Math.round(Number(n) * 10000) / 10000

const DEADLINE_MS = 24 * 3600000
const MAX_FAILS = 2
const CARD_METHODS = ['creditcard', 'applepay', 'googlepay']
const isCardPayment = (p) => CARD_METHODS.includes(p?.method) || CARD_METHODS.includes(p?.details?.wallet)

const tokens = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/['-]/g, '').split(/\s+/).filter(Boolean)
// 'match' = same person for sure, 'doubt' = admin should look, 'mismatch' = clearly another person.
function compareNames(idName, cardName) {
  const a = tokens(idName), b = tokens(cardName)
  if (!a.length || !b.length) return 'doubt'
  const A = new Set(a), B = new Set(b)
  const full = (x, y) => [...x].every(t => y.has(t))
  if (full(A, B) && full(B, A)) return 'match'
  // Middle name left off one side: every word of the shorter name is in the longer one (at least first + last).
  const [small, big] = A.size <= B.size ? [A, B] : [B, A]
  if (small.size >= 2 && full(small, big)) return 'match'
  const shared = [...A].filter(t => t.length > 1 && B.has(t)).length
  const initials = [...small].some(t => t.length === 1 && [...big].some(u => u[0] === t))
  return shared || initials ? 'doubt' : 'mismatch'
}
// Worst result across every held card payment decides.
function decide(idName, cardNames) {
  const r = cardNames.length ? cardNames.map(n => compareNames(idName, n)) : ['doubt']
  return r.includes('mismatch') ? 'mismatch' : r.includes('doubt') ? 'doubt' : 'match'
}

function createCardCheck(db, { log = console.log, notifyAdmin, push, refundPayment, retrieveSession, applySession, replay }) {
  const col = db.collection('compliance'), deposits = db.collection('webDeposits'), walletOf = db.collection('walletOf'), txns = db.collection('transactions')
  const esc = (s) => String(s ?? '').replace(/[<&>]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]))
  const usd = (n) => `$${Number(n || 0).toFixed(2)}`
  const of = async (chatId) => (await col.findOne({ _id: String(chatId) })) || { _id: String(chatId) }
  const held = (chatId) => deposits.find({ chatId: { $in: [chatId, String(chatId), Number(chatId)].filter(v => v === v) }, provider: 'mollie', idHold: true }).toArray()
  // Short email for each step (also in the app inbox via push).
  const site = () => `https://${String(process.env.CLOUDIVR_WEB_DOMAIN || 'cloudivr.net').replace(/^https?:\/\//, '')}`
  async function mail(chatId, subject, title, lines, points, cta) {
    try {
      const acc = await db.collection('webAccounts').findOne({ _id: Number(chatId) }, { projection: { email: 1 } })
      if (!acc?.email) return
      const L = require('./email-layout')
      const body = lines.map(x => L.p(x)).join('') + (points ? L.bullets(points) : '') + (cta ? L.button(cta[0], `${site()}${cta[1]}`) : '')
      await require('./auth').sendMail(acc.email, subject, L.layout({ preheader: lines[0], eyebrow: 'Card payment', title, body }))
    } catch (e) { log(`[CardCheck] email ${chatId}: ${e.message}`) }
  }
  const passed = async (chatId) => (await of(chatId)).cardCheck?.status === 'passed'

  // Called by Mollie settle for a paid card payment: true → credit as held. Off while no Stripe key is set
  // (a held payment could never be verified and would just be refunded).
  const needsHold = async (chatId, p) => !!(process.env.STRIPE_IDENTITY_SECRET_KEY || process.env.STRIPE_SECRET_KEY) && isCardPayment(p) && !(await passed(chatId))
  // Credits the wallet with the amount held back (balance unchanged until released).
  async function creditHeld(chatId, amount) {
    const amt = round4(amount)
    await walletOf.updateOne({ _id: String(chatId) }, { $inc: { usdIn: amt, usdOut: amt, usdHeld: amt } }, { upsert: true })
  }
  // Wallet part of a held wallet + card order: set aside (not spendable) until the order runs or is cancelled.
  async function reserve(chatId, amount) {
    const amt = round4(Math.max(0, Number(amount) || 0))
    if (!amt) return 0
    const r = await walletOf.updateOne({ _id: String(chatId), $expr: { $gte: [{ $subtract: [{ $ifNull: ['$usdIn', 0] }, { $ifNull: ['$usdOut', 0] }] }, amt] } }, { $inc: { usdOut: amt, usdHeld: amt } })
    return r.modifiedCount === 1 ? amt : 0
  }

  async function onHeld(dep, p) {
    const chatId = String(dep.chatId), d = await of(chatId), st = d.cardCheck?.status
    if (!['required', 'review'].includes(st)) {
      await col.updateOne({ _id: chatId }, { $set: { cardCheck: { status: 'required', startedAt: new Date(), deadline: new Date(Date.now() + DEADLINE_MS), failedSessions: [] } } }, { upsert: true })
    }
    log(`[CardCheck] ${chatId} card payment ${dep.ref} held ($${dep.amountUsd}) — ID check ${st === 'review' ? 'in review' : 'required'}`)
    if (d.identity?.status === 'verified') return evaluate(chatId)
    if (st !== 'review') mail(chatId, `Verify your ID to use your ${usd(dep.amountUsd)} top-up`, 'One quick ID check', [`We received your card payment of ${usd(dep.amountUsd)}. It is in your wallet, on hold until you verify your ID — a one-time check that takes about 2 minutes.`], ['Photo ID + a quick selfie; the name must match the card', 'Done once — future card payments are never held', 'Not done within 24 hours? The payment is refunded to your card'], ['Verify my ID', '/app/wallet'])
    if (st !== 'review') push?.(chatId, `Payment received: ${usd(dep.amountUsd)} is in your wallet but on hold. Verify your ID within 24 hours (photo ID + quick selfie, name must match the card) to use it — otherwise the payment is refunded to your card. Wallet → Verify ID.`).catch?.(() => {})
  }

  async function release(chatId, why) {
    let total = 0
    for (const dep of await held(chatId)) {
      const r = await deposits.updateOne({ _id: dep._id, idHold: true }, { $set: { idHold: false, idReleasedAt: new Date(), idReleaseWhy: why } })
      if (r.modifiedCount !== 1) continue
      const amt = round4(dep.amountUsd), back = round4(amt + (dep.reservedUsd || 0))
      await walletOf.updateOne({ _id: String(chatId) }, { $inc: { usdOut: -back, usdHeld: -back } })
      total += amt
      for (const a of dep.pendingActions || []) {
        const r = await replay?.(chatId, a).catch(e => ({ status: 0, message: e.message }))
        log(`[CardCheck] ${chatId} saved order ${a.method} ${a.path} → ${r?.status}`)
        const okd = r?.status >= 200 && r.status < 300
        await deposits.updateOne({ _id: dep._id }, { $set: { orderResult: { state: okd ? 'done' : 'failed', status: r?.status || 0, message: r?.message || null, at: new Date() } } })
        if (!okd) {
          push?.(String(chatId), `Your saved order could not be completed automatically${r?.message ? `: ${r.message}` : ''}. Your money is in your wallet — please place the order again.`).catch?.(() => {})
          notifyAdmin?.(`⚠️ <b>Saved card order failed</b> — web account ${esc(chatId)} ${esc(a.method)} ${esc(a.path)} → ${esc(r?.status)} ${esc(r?.message || '')}`)
        } else push?.(String(chatId), 'Your saved order went through now that your ID check is approved.').catch?.(() => {})
      }
    }
    await col.updateOne({ _id: String(chatId) }, { $set: { 'cardCheck.status': 'passed', 'cardCheck.decidedAt': new Date(), 'cardCheck.reason': why } })
    log(`[CardCheck] ${chatId} passed (${why}) — released $${total}`)
    mail(chatId, 'ID verified — your balance is ready', 'You’re verified', [`Your ID check passed${total ? ` and ${usd(total)} is now available in your wallet` : ''}.`], ['Card, Apple Pay and Google Pay top-ups go straight to your balance from now on', 'You won’t be asked to verify again'], ['Open my wallet', '/app/wallet'])
    push?.(String(chatId), `ID check passed${total ? ` — ${usd(total)} is now available in your wallet` : ''}. You won't be asked again.`).catch?.(() => {})
    return total
  }

  async function refundAll(chatId, why) {
    let total = 0, failed = 0
    for (const dep of await held(chatId)) {
      const claim = await deposits.updateOne({ _id: dep._id, idHold: true, refundState: { $nin: ['pending', 'refunded'] } }, { $set: { refundState: 'pending' } })
      if (claim.modifiedCount !== 1) continue
      try {
        const rf = await refundPayment(dep, `CloudIVR card payment refunded: ${why}`)
        const amt = round4(dep.amountUsd), res = round4(dep.reservedUsd || 0)
        await deposits.updateOne({ _id: dep._id }, { $set: { idHold: false, refundState: 'refunded', refundId: rf?.id || null, refundedAt: new Date(), refundWhy: why } })
        // Card part goes back to the card; a set-aside wallet part goes back to the balance; the saved order is dropped.
        await walletOf.updateOne({ _id: String(chatId) }, { $inc: { usdIn: -amt, usdOut: -amt - res, usdHeld: -amt - res } })
        if (dep.pendingActions?.length) {
          await deposits.updateOne({ _id: dep._id }, { $set: { orderResult: { state: 'cancelled', status: 0, message: 'The card payment was refunded, so the order was cancelled.', at: new Date() } } })
          push?.(String(chatId), `Your saved order was cancelled because the card payment was refunded.${res ? ` The ${usd(res)} from your wallet is back in your balance.` : ''}`).catch?.(() => {})
        }
        await txns.insertOne({ chatId: String(chatId), type: 'card-refund', amount: amt, currency: 'USD', status: 'completed', metadata: { ref: dep.ref, paymentId: dep.molliePaymentId, refundId: rf?.id || null, value: dep.amountCharged, coin: dep.currency, why }, createdAt: new Date(), updatedAt: new Date() })
        total += amt
      } catch (e) {
        failed++
        const msg = String(e.response?.data?.detail || e.message)
        await deposits.updateOne({ _id: dep._id }, { $set: { refundState: 'failed', refundError: msg.slice(0, 300) } })
        log(`[CardCheck] refund failed ${dep.ref}: ${msg}`)
        notifyAdmin?.(`⚠️ <b>Card refund failed</b> — web account ${esc(chatId)}, deposit <code>${esc(dep.ref)}</code> (${esc(dep.amountCharged)} ${esc(dep.currency)}): ${esc(msg)}\nThe money stays on hold. Retry from Admin → Compliance → Card ID checks.`)
      }
    }
    if (!failed) await col.updateOne({ _id: String(chatId) }, { $set: { 'cardCheck.status': 'refunded', 'cardCheck.decidedAt': new Date(), 'cardCheck.reason': why } })
    log(`[CardCheck] ${chatId} refunded $${total} (${why})${failed ? `, ${failed} refund(s) failed` : ''}`)
    if (total) {
      mail(chatId, `Your ${usd(total)} card payment was refunded`, 'Payment refunded', [`Your card payment of ${usd(total)} was refunded to your card because ${why}.`, 'Refunds usually show within 5–10 days. You can still top up with crypto or another method.'], null, ['Open my wallet', '/app/wallet'])
      push?.(String(chatId), `Your card payment of ${usd(total)} was refunded to your card: ${why}. Refunds usually show within 5–10 days.`).catch?.(() => {})
      notifyAdmin?.(`↩️ <b>Card payment refunded</b> — web account ${esc(chatId)}: ${usd(total)} (${esc(why)})`)
    }
    return { total, failed }
  }

  async function evaluate(chatId) {
    const d = await of(chatId)
    if (!['required', 'review'].includes(d.cardCheck?.status) || d.identity?.status !== 'verified') return null
    const deps = await held(chatId)
    if (!deps.length) return null
    // IDs verified before names were stored: read the name from Stripe once.
    if (!d.identity.name && d.identity.sessionId && retrieveSession) {
      const vo = (await retrieveSession(d.identity.sessionId, true).catch(() => null))?.verified_outputs
      d.identity.name = [vo?.first_name, vo?.last_name].filter(Boolean).join(' ') || null
      if (d.identity.name) await col.updateOne({ _id: String(chatId) }, { $set: { 'identity.name': d.identity.name } })
    }
    const idName = d.identity.name || '', cardNames = deps.map(x => x.cardHolder).filter(Boolean)
    const result = decide(idName, deps.some(x => !x.cardHolder) ? [...cardNames, ''] : cardNames)
    await col.updateOne({ _id: String(chatId) }, { $set: { 'cardCheck.idName': idName, 'cardCheck.cardNames': cardNames, 'cardCheck.match': result } })
    if (result === 'match') return release(chatId, 'ID name matches the card')
    if (result === 'mismatch') return refundAll(chatId, 'the name on your ID does not match the name on the card')
    if (d.cardCheck.status !== 'review') {
      await col.updateOne({ _id: String(chatId) }, { $set: { 'cardCheck.status': 'review', 'cardCheck.reviewSince': new Date() } })
      notifyAdmin?.(`🪪 <b>Card ID check needs review</b> — web account ${esc(chatId)}\nID name: <b>${esc(idName) || '—'}</b>\nCard name(s): <b>${esc(cardNames.join(', ')) || 'not given by the card / wallet'}</b>\nHeld: ${usd(deps.reduce((s, x) => s + x.amountUsd, 0))}\nApprove or refund in Admin → Compliance → Card ID checks.`)
      mail(chatId, 'ID received — we’re confirming your card', 'Almost done', ['Thanks — your ID was received. We are confirming it matches your card; your top-up stays on hold until then, usually within a few hours.', 'We’ll email you as soon as it’s released.'])
      push?.(String(chatId), 'Thanks — your ID was received. We are confirming it matches your card; your top-up stays on hold until then (usually within a few hours).').catch?.(() => {})
    }
    return 'review'
  }

  // From the Stripe Identity status (webhook / refresh / sweep).
  async function onIdentity(chatId, status, session) {
    const d = await of(chatId), st = d.cardCheck?.status
    if (!['required', 'review'].includes(st)) return
    if (status === 'verified') return evaluate(chatId)
    if (status === 'failed' && st === 'required' && session?.id) {
      const r = await col.findOneAndUpdate({ _id: String(chatId) }, { $addToSet: { 'cardCheck.failedSessions': session.id } }, { returnDocument: 'after' })
      const fails = ((r?.value || r)?.cardCheck?.failedSessions || []).length
      if (fails >= MAX_FAILS) return refundAll(chatId, 'the ID check did not pass')
      // Notify customer they can try again
      const reason = session?.last_error?.reason || session?.last_error?.code || 'The check could not be completed'
      mail(chatId, 'ID check not successful \u2014 try again', 'ID check issue', [`Your ID check did not go through: ${reason}.`, `You have ${MAX_FAILS - fails} attempt(s) left. Your payment stays on hold until verified.`], ['Use a well-lit area for the selfie', 'Make sure the name on your ID matches the card name', "Try a different document type if one doesn't work"], ['Try again', '/app/wallet'])
      push?.(String(chatId), `Your ID check did not go through: ${reason}. You have ${MAX_FAILS - fails} attempt(s) left \u2014 try again in Wallet \u2192 Verify ID.`).catch?.(() => {})
    }
  }

  // Every few minutes: pick up Stripe results the webhook missed, refund checks past their deadline.
  async function tick() {
    const open = await col.find({ 'cardCheck.status': 'required' }).limit(200).toArray()
    for (const d of open) {
      const chatId = String(d._id)
      try {
        if (d.identity?.sessionId && d.identity.status !== 'verified' && retrieveSession) await applySession(await retrieveSession(d.identity.sessionId))
        const now = await of(chatId)
        if (now.cardCheck?.status === 'required' && now.identity?.status === 'verified') await evaluate(chatId)
        else if (now.cardCheck?.status === 'required' && new Date(now.cardCheck.deadline) < new Date()) await refundAll(chatId, 'no ID check was completed within 24 hours')
      } catch (e) { log(`[CardCheck] tick ${chatId}: ${e.message}`) }
    }
  }

  async function status(chatId) {
    const d = await of(chatId), deps = await held(chatId)
    const c = d.cardCheck || {}
    return {
      status: c.status || 'none', heldUsd: round4(deps.reduce((s, x) => s + x.amountUsd, 0)), deadline: c.deadline || null,
      attempts: (c.failedSessions || []).length, maxAttempts: MAX_FAILS, identity: d.identity?.status || 'none', reason: c.reason || null,
    }
  }

  function routes(r, h) {
    r.get('/card-check', h(async (req, res) => res.json(await status(req.webChatId))))
  }

  function adminRoutes(r, h, A) {
    r.get('/admin/card-checks/count', A, h(async (req, res) => res.json({ open: await col.countDocuments({ 'cardCheck.status': { $in: ['review', 'required'] } }), review: await col.countDocuments({ 'cardCheck.status': 'review' }) })))
    r.get('/admin/card-checks', A, h(async (req, res) => {
      const st = ['review', 'required', 'passed', 'refunded'].includes(req.query.status) ? req.query.status : 'review'
      const docs = await col.find({ 'cardCheck.status': st }).sort({ 'cardCheck.startedAt': -1 }).limit(100).toArray()
      const accs = new Map((await db.collection('webAccounts').find({ _id: { $in: docs.map(d => Number(d._id)).filter(Boolean) } }, { projection: { email: 1 } }).toArray()).map(a => [String(a._id), a]))
      const items = await Promise.all(docs.map(async d => {
        const deps = await deposits.find({ chatId: { $in: [d._id, Number(d._id)] }, provider: 'mollie', $or: [{ idHold: true }, { refundState: { $exists: true } }, { idReleasedAt: { $exists: true } }] }).sort({ createdAt: -1 }).limit(20).toArray()
        return { chatId: d._id, email: accs.get(String(d._id))?.email || null, ...d.cardCheck, identity: { status: d.identity?.status || 'none', name: d.identity?.name || null },
          deposits: deps.map(x => ({ ref: x.ref, amountUsd: x.amountUsd, amount: x.amountCharged, currency: x.currency, method: x.mollieMethod, cardHolder: x.cardHolder || null, held: !!x.idHold, refundState: x.refundState || null, refundError: x.refundError || null, paidAt: x.paidAt })) }
      }))
      res.json({ items })
    }))
    r.post('/admin/card-checks/:chatId', A, h(async (req, res) => {
      const chatId = String(req.params.chatId), decision = req.body?.decision
      if (!['approve', 'refund'].includes(decision)) return res.status(400).json({ error: 'invalid', message: 'Pick approve or refund.' })
      const d = await of(chatId)
      if (!['required', 'review'].includes(d.cardCheck?.status) && !(decision === 'refund' && (await held(chatId)).length)) return res.status(409).json({ error: 'not_open', message: 'This check is already decided.' })
      log(`[CardCheck] admin ${req.admin?.email || 'admin'} → ${decision} ${chatId}`)
      if (decision === 'approve') return res.json({ ok: true, released: await release(chatId, `approved by ${req.admin?.email || 'admin'}`) })
      await deposits.updateMany({ chatId: { $in: [chatId, Number(chatId)] }, idHold: true, refundState: 'failed' }, { $unset: { refundState: '' } })
      res.json({ ok: true, ...(await refundAll(chatId, String(req.body?.note || '').slice(0, 200) || 'the ID check did not pass review')) })
    }))
  }

  return { needsHold, creditHeld, reserve, onHeld, onIdentity, evaluate, release, refundAll, tick, status, routes, adminRoutes, passed }
}

module.exports = { createCardCheck, compareNames, decide, isCardPayment, DEADLINE_MS, MAX_FAILS }
