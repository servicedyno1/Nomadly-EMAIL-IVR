'use strict'
// Mollie checkout (cards, PayPal, iDEAL, Bancontact … whatever the Mollie account has on) for CloudIVR web.
// Every Mollie payment is a wallet top-up in USD: the customer may pay in USD, EUR or another currency the account
// accepts (converted at the day's rate); the wallet is credited the USD amount once Mollie says "paid".
// Checkouts (numbers, renewals, plans …) use it the same way as crypto: top up what's missing, then pay from the wallet.
const axios = require('axios')
const { walletOps, round2, MIN_TOPUP_USD } = require('./wallet')

const API = 'https://api.mollie.com/v2'
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK']
const key = () => String(process.env.MOLLIE_API_KEY || '').trim()
// test_… = test mode; live_… or an organization access token (access_…) = real payments.
const mode = () => (key().startsWith('test_') ? 'test' : /^(live_|access_)/.test(key()) ? 'live' : null)
const mollie = (method, path, data, idem) => axios({ method, url: `${API}${path}`, data, timeout: 20000, headers: { Authorization: `Bearer ${key()}`, ...(idem ? { 'Idempotency-Key': idem } : {}) } }).then(r => r.data)
const fix2 = (n) => (Math.ceil(Number(n) * 100 - 1e-6) / 100).toFixed(2)

const fx = { at: 0, rates: null }
async function rates() {
  if (fx.rates && Date.now() - fx.at < 3600000) return fx.rates
  try {
    const r = await axios.get('https://api.frankfurter.app/latest', { params: { from: 'USD', to: CURRENCIES.filter(c => c !== 'USD').join(',') }, timeout: 10000 })
    if (r.data?.rates) Object.assign(fx, { at: Date.now(), rates: { USD: 1, ...r.data.rates } })
  } catch (_) { /* keep the last good rates; USD always works */ }
  return fx.rates || { USD: 1 }
}

const methodCache = new Map()
async function methodsFor(currency, value) {
  const k = `${mode()}:${currency}:${Math.round(Number(value))}`, hit = methodCache.get(k)
  if (hit && Date.now() - hit.at < 600000) return hit.list
  let list = []
  try {
    const r = await mollie('get', `/methods?amount[value]=${value}&amount[currency]=${currency}&sequenceType=oneoff&resource=payments`)
    list = (r?._embedded?.methods || []).map(m => ({ id: m.id, description: m.description, image: m.image?.svg || m.image?.size2x || null }))
  } catch (_) { list = null }
  if (list) methodCache.set(k, { at: Date.now(), list })
  return list || []
}

function createMollie(db, { log = console.log, push, notifyAdmin, getOffers } = {}) {
  const deposits = db.collection('webDeposits'), txns = db.collection('transactions'), w = walletOps(db)
  const enabled = () => !!mode()

  async function options(amountUsd) {
    const usd = round2(Math.max(MIN_TOPUP_USD, Number(amountUsd) || MIN_TOPUP_USD)), fxr = await rates()
    const got = await Promise.all(CURRENCIES.filter(c => fxr[c]).map(async c => {
      const amount = fix2(usd * fxr[c]), methods = await methodsFor(c, amount)
      return methods.length ? { currency: c, amount, rate: fxr[c], methods } : null
    }))
    return { enabled: true, mode: mode(), amountUsd: usd, currencies: got.filter(Boolean), ratesAt: fx.at ? new Date(fx.at).toISOString() : null }
  }

  // Credit once: the deposit flips to paid atomically, so webhook + status poll + retries can't double-credit.
  async function settle(dep, p) {
    const status = p.status
    if (status !== 'paid') {
      await deposits.updateOne({ _id: dep._id, molliePaid: { $ne: true } }, { $set: { mollieStatus: status, updatedAt: new Date() } })
      return { status }
    }
    if (p.amount?.currency !== dep.currency || p.amount?.value !== dep.amountCharged) {
      log(`[Mollie] amount mismatch for ${dep.ref}: ${JSON.stringify(p.amount)} vs ${dep.amountCharged} ${dep.currency}`)
      notifyAdmin?.(`⚠️ <b>Mollie amount mismatch</b>\nDeposit <code>${dep.ref}</code> expected ${dep.amountCharged} ${dep.currency}, Mollie says ${p.amount?.value} ${p.amount?.currency}. Not credited — check it by hand.`)
      return { status: 'review' }
    }
    const r = await deposits.updateOne({ _id: dep._id, molliePaid: { $ne: true } }, { $set: { molliePaid: true, mollieStatus: 'paid', mollieMethod: p.method || null, paidAt: new Date(p.paidAt || Date.now()), updatedAt: new Date() } })
    if (r.modifiedCount !== 1) return { status: 'paid', already: true }
    await w.credit(dep.chatId, dep.amountUsd)
    const label = `${dep.amountCharged} ${dep.currency}`
    await txns.insertOne({ chatId: String(dep.chatId), type: 'wallet-topup', amount: dep.amountUsd, currency: 'USD', status: 'completed', metadata: { ref: dep.ref, psp: 'mollie', mode: dep.mode, method: p.method || null, value: dep.amountCharged, coin: dep.currency, paymentId: p.id }, createdAt: new Date(), updatedAt: new Date() })
    log(`[Mollie] credited $${dep.amountUsd} to ${dep.chatId} (${label}, ${p.method}, ${dep.mode})`)
    push?.(String(dep.chatId), `Payment received: $${dep.amountUsd.toFixed(2)} was added to your wallet (${label} by ${p.method || 'Mollie'}).`).catch?.(() => {})
    notifyAdmin?.(`💳 <b>Wallet top-up (Mollie${dep.mode === 'test' ? ' · TEST' : ''})</b>\n👤 Web account ${dep.chatId}\n💵 Credited <b>$${dep.amountUsd.toFixed(2)}</b>\n💶 Paid ${label} · ${p.method || '?'}\n🔖 <code>${dep.ref}</code> · <code>${p.id}</code>`)
    return { status: 'paid' }
  }

  async function sync(dep) {
    if (!dep?.molliePaymentId || dep.molliePaid) return { status: dep?.molliePaid ? 'paid' : dep?.mollieStatus || 'open' }
    return settle(dep, await mollie('get', `/payments/${dep.molliePaymentId}`))
  }

  function publicRoutes(router, { h }) {
    // Mollie only sends the payment id; we fetch the payment ourselves, so a forged call can't credit anything.
    router.post('/mollie/webhook', h(async (req, res) => {
      const id = String(req.body?.id || '')
      if (!/^tr_[A-Za-z0-9]+$/.test(id) || !enabled()) return res.status(200).send('ok')
      const dep = await deposits.findOne({ molliePaymentId: id })
      if (dep) await sync(dep).catch(e => { log(`[Mollie] webhook ${id}: ${e.message}`); throw e })
      res.status(200).send('ok')
    }))
  }

  function routes(router, { h }) {
    router.get('/wallet/mollie/options', h(async (req, res) => {
      if (!enabled()) return res.json({ enabled: false, currencies: [] })
      res.json(await options(req.query.amountUsd))
    }))
    router.post('/wallet/mollie/pay', h(async (req, res) => {
      if (!enabled()) return res.status(424).json({ error: 'mollie_off', message: 'Card payments are not available right now.' })
      const amountUsd = round2(req.body.amountUsd), currency = String(req.body.currency || 'USD').toUpperCase(), method = req.body.method ? String(req.body.method) : null
      if (!(amountUsd >= MIN_TOPUP_USD) || amountUsd > 10000) return res.status(400).json({ error: 'invalid_amount', message: `Top up between $${MIN_TOPUP_USD} and $10,000.` })
      const opt = (await options(amountUsd)).currencies.find(c => c.currency === currency)
      if (!opt) return res.status(400).json({ error: 'invalid_currency', message: 'That currency is not available. Pick another one.' })
      if (method && !opt.methods.some(m => m.id === method)) return res.status(400).json({ error: 'invalid_method', message: 'That payment method is not available for this currency.' })
      const back = String(req.body.returnUrl || ''), origin = String(req.get('origin') || '')
      if (!origin || !back.startsWith(`${origin}/`)) return res.status(400).json({ error: 'invalid_return', message: 'Open the payment from the CloudIVR app.' })
      const ref = `mol_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const offers = getOffers?.(), bonus = offers ? await offers.topupBonusFor(req.webChatId).catch(() => null) : null
      const dep = { chatId: req.webChatId, ref, amountUsd, coin: 'Card / PayPal', provider: 'mollie', mode: mode(), currency, amountCharged: opt.amount, method, bonus, bonusPaidAt: null, createdAt: new Date() }
      const { insertedId } = await deposits.insertOne(dep)
      let p
      try {
        p = await mollie('post', '/payments', {
          amount: { currency, value: opt.amount }, description: `CloudIVR wallet top-up $${amountUsd.toFixed(2)}`,
          redirectUrl: `${back}${back.includes('?') ? '&' : '?'}mollie=${ref}`, cancelUrl: `${back}${back.includes('?') ? '&' : '?'}mollie=${ref}`,
          webhookUrl: `${process.env.SELF_URL}/cloudivr-web/mollie/webhook`, metadata: { ref, chatId: String(req.webChatId) }, ...(method ? { method } : {}),
        }, `cloudivr-${ref}`)
      } catch (e) {
        await deposits.updateOne({ _id: insertedId }, { $set: { mollieStatus: 'error', mollieError: String(e.response?.data?.detail || e.message).slice(0, 300) } })
        log(`[Mollie] create failed ${ref}: ${e.response?.data?.detail || e.message}`)
        return res.status(424).json({ error: 'mollie_error', message: 'The card payment service did not answer. Try again or pick another method.' })
      }
      await deposits.updateOne({ _id: insertedId }, { $set: { molliePaymentId: p.id, mollieStatus: p.status } })
      res.status(201).json({ ref, checkoutUrl: p._links?.checkout?.href, amountUsd, currency, amount: opt.amount, mode: mode() })
    }))
    router.get('/wallet/mollie/:ref', h(async (req, res) => {
      const dep = await deposits.findOne({ ref: String(req.params.ref), chatId: req.webChatId, provider: 'mollie' })
      if (!dep) return res.status(404).json({ error: 'not_found', message: 'Payment not found.' })
      const s = await sync(dep).catch(() => ({ status: dep.mollieStatus || 'open' }))
      res.json({ ref: dep.ref, status: s.status, amountUsd: dep.amountUsd, currency: dep.currency, amount: dep.amountCharged })
    }))
  }

  return { enabled, options, sync, settle, routes, publicRoutes }
}

module.exports = { createMollie, CURRENCIES, mode }
