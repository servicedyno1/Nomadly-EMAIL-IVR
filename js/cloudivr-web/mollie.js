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
// Organization access token: one key for every website profile; each call names the profile it is for.
const orgKey = () => String(process.env.MOLLIE_CLOUDIVR_API_KEY || '').trim()
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase() } catch (_) { return '' } }
const profiles = { at: 0, byHost: new Map() }
// Which Mollie account a site pays through: the profile whose website is that site (org token), else the single-profile key.
async function via(origin) {
  if (orgKey()) {
    if (Date.now() - profiles.at > 3600000) {
      try {
        const r = await axios.get(`${API}/profiles?limit=250`, { timeout: 20000, headers: { Authorization: `Bearer ${orgKey()}` } })
        profiles.byHost = new Map((r.data?._embedded?.profiles || []).filter(p => p.status === 'verified').map(p => [hostOf(p.website), p.id]))
        profiles.at = Date.now()
      } catch (_) { /* keep the last list */ }
    }
    const profileId = profiles.byHost.get(hostOf(origin))
    if (profileId) return { profileId }
  }
  return {}
}
const mollie = (method, path, data, idem, v) => {
  const pid = v?.profileId
  const url = `${API}${path}${pid && method === 'get' && /^\/(methods|payments)\?/.test(path) ? `&profileId=${pid}` : ''}`
  return axios({ method, url, data: pid && data ? { profileId: pid, ...data } : data, timeout: 20000, headers: { Authorization: `Bearer ${pid ? orgKey() : key()}`, ...(idem ? { 'Idempotency-Key': idem } : {}) } }).then(r => r.data)
}
const modeOf = (v) => (v?.profileId ? 'live' : mode())
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
async function methodsFor(currency, value, v) {
  const k = `${v?.profileId || mode()}:${currency}:${Math.round(Number(value))}`, hit = methodCache.get(k)
  if (hit && Date.now() - hit.at < 600000) return hit.list
  let list = []
  try {
    const r = await mollie('get', `/methods?amount[value]=${value}&amount[currency]=${currency}&sequenceType=oneoff&resource=payments`, null, null, v)
    list = (r?._embedded?.methods || []).map(m => ({ id: m.id, description: m.description, image: m.image?.svg || m.image?.size2x || null }))
  } catch (_) { list = null }
  if (list) methodCache.set(k, { at: Date.now(), list })
  return list || []
}

function createMollie(db, { log = console.log, push, notifyAdmin, getOffers, getCardCheck } = {}) {
  const deposits = db.collection('webDeposits'), txns = db.collection('transactions'), w = walletOps(db)
  const keyed = () => !!mode() || !!orgKey()
  let lastFailAlert = 0
  // Card stays "coming soon" on a site until Mollie accepts its domain (website profile). Probed per site with a throwaway Checkout Session, re-checked every 30 min.
  const sites = new Map()
  const notApproved = (why) => /redirect url|profile url|registered domain|website profile/i.test(String(why || ''))
  const siteOf = (req) => `https://${String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim()}`
  const markSite = (origin, ok, why = '') => {
    const was = sites.get(origin)?.ok
    sites.set(origin, { ok, why, at: Date.now() })
    if (was !== undefined && was !== ok) log(`[Mollie] ${origin} card payments ${ok ? 'ON — domain approved' : `OFF — ${why}`}`)
    if (ok && was === false) notifyAdmin?.(`✅ <b>Mollie approved ${origin.replace(/^https:\/\//, '')}</b> — card payments are now live there.`)
  }
  async function checkDomain(origin) {
    if (!keyed() || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) return false
    const hit = sites.get(origin)
    if (hit && Date.now() - hit.at < 30 * 60000) return hit.ok
    if (sites.size > 50) sites.clear()
    const money = { currency: 'EUR', value: '10.00' }
    try {
      const v = await via(origin)
      if (!v.profileId && !mode()) return false
      await mollie('post', '/sessions', { amount: money, description: 'Domain check', lines: [{ type: 'digital', description: 'Domain check', quantity: 1, unitPrice: money, totalAmount: money }], redirectUrl: `${origin}/cloudivr/app/wallet` }, null, v)
      markSite(origin, true)
    } catch (e) {
      const why = String(e.response?.data?.detail || e.message)
      if (notApproved(why) || e.response?.status === 401) markSite(origin, false, why)
      else { log(`[Mollie] domain check inconclusive for ${origin}: ${why}`); return hit?.ok || false }
    }
    return sites.get(origin).ok
  }
  const enabled = () => keyed()
  // Cached answer for public pages; refreshes in the background so the page never waits on Mollie.
  const cardsLive = (req) => { const o = siteOf(req); checkDomain(o).catch(() => {}); return sites.get(o)?.ok === true }

  async function options(amountUsd, v) {
    const usd = round2(Math.max(MIN_TOPUP_USD, Number(amountUsd) || MIN_TOPUP_USD)), fxr = await rates()
    const got = await Promise.all(CURRENCIES.filter(c => fxr[c]).map(async c => {
      const amount = fix2(usd * fxr[c]), methods = await methodsFor(c, amount, v)
      return methods.length ? { currency: c, amount, rate: fxr[c], methods } : null
    }))
    return { enabled: true, mode: modeOf(v), amountUsd: usd, currencies: got.filter(Boolean), ratesAt: fx.at ? new Date(fx.at).toISOString() : null }
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
    // First card / Apple Pay / Google Pay payment of an account: credited but held until the ID check (card-check.js).
    const cc = getCardCheck?.(), hold = cc ? await cc.needsHold(dep.chatId, p) : false
    const r = await deposits.updateOne({ _id: dep._id, molliePaid: { $ne: true } }, { $set: { molliePaid: true, mollieStatus: 'paid', mollieMethod: p.details?.wallet || p.method || null, cardHolder: p.details?.cardHolder || null, idHold: hold, paidAt: new Date(p.paidAt || Date.now()), updatedAt: new Date() } })
    if (r.modifiedCount !== 1) return { status: 'paid', already: true }
    if (hold) await cc.creditHeld(dep.chatId, dep.amountUsd)
    else await w.credit(dep.chatId, dep.amountUsd)
    const label = `${dep.amountCharged} ${dep.currency}`
    await txns.insertOne({ chatId: String(dep.chatId), type: 'wallet-topup', amount: dep.amountUsd, currency: 'USD', status: 'completed', metadata: { ref: dep.ref, psp: 'mollie', mode: dep.mode, method: p.method || null, value: dep.amountCharged, coin: dep.currency, paymentId: p.id }, createdAt: new Date(), updatedAt: new Date() })
    log(`[Mollie] credited $${dep.amountUsd} to ${dep.chatId} (${label}, ${p.method}, ${dep.mode})`)
    if (!hold) push?.(String(dep.chatId), `Payment received: $${dep.amountUsd.toFixed(2)} was added to your wallet (${label} by ${p.method || 'Mollie'}).`).catch?.(() => {})
    notifyAdmin?.(`💳 <b>Wallet top-up (Mollie${dep.mode === 'test' ? ' · TEST' : ''})</b>\n👤 Web account ${dep.chatId}\n💵 Credited <b>$${dep.amountUsd.toFixed(2)}</b>${hold ? ' · <b>on hold until ID check</b>' : ''}\n💶 Paid ${label} · ${p.details?.wallet || p.method || '?'}\n🔖 <code>${dep.ref}</code> · <code>${p.id}</code>`)
    if (hold) await cc.onHeld({ ...dep, cardHolder: p.details?.cardHolder || null }, p).catch(e => log(`[CardCheck] onHeld ${dep.ref}: ${e.message}`))
    return { status: 'paid', held: hold }
  }

  // Full refund of a paid deposit back to the card (ID check failed). Idempotent per deposit.
  async function refund(dep, description) {
    const pid = dep.mollieProfile
    const r = await axios.post(`${API}/payments/${dep.molliePaymentId}/refunds`, { amount: { currency: dep.currency, value: dep.amountCharged }, description: String(description).slice(0, 140), metadata: { ref: dep.ref } },
      { timeout: 20000, headers: { Authorization: `Bearer ${pid ? orgKey() : key()}`, 'Idempotency-Key': `cloudivr-refund-${dep.ref}` } })
    return r.data
  }

  // In-app checkouts (Checkout Sessions) learn their payment id from the webhook, or from recent payments by metadata.ref.
  async function findSessionPayment(dep) {
    const v = dep.mollieProfile ? { profileId: dep.mollieProfile } : null
    const s = await mollie('get', `/sessions/${dep.mollieSessionId}`, null, null, v)
    if (s.status === 'expired') { await deposits.updateOne({ _id: dep._id, molliePaid: { $ne: true } }, { $set: { mollieStatus: 'expired' } }); return null }
    if (s.status !== 'completed') return null
    const list = (await mollie('get', '/payments?limit=50', null, null, v))?._embedded?.payments || []
    const p = list.find(x => x.metadata?.ref === dep.ref)
    if (p) await deposits.updateOne({ _id: dep._id }, { $set: { molliePaymentId: p.id } })
    return p || null
  }
  async function sync(dep) {
    if (dep?.molliePaid) return { status: 'paid' }
    if (!dep?.molliePaymentId && dep?.mollieSessionId) {
      const p = await findSessionPayment(dep)
      return p ? settle(dep, p) : { status: (await deposits.findOne({ _id: dep._id }))?.mollieStatus || 'open' }
    }
    if (!dep?.molliePaymentId) return { status: dep?.mollieStatus || 'open' }
    return settle(dep, await mollie('get', `/payments/${dep.molliePaymentId}`, null, null, dep.mollieProfile ? { profileId: dep.mollieProfile } : null))
  }

  function publicRoutes(router, { h }) {
    // Mollie only sends the payment id; we fetch the payment ourselves, so a forged call can't credit anything.
    router.post('/mollie/webhook', h(async (req, res) => {
      const id = String(req.body?.id || '')
      if (!/^tr_[A-Za-z0-9]+$/.test(id) || !keyed()) return res.status(200).send('ok')
      let dep = await deposits.findOne({ molliePaymentId: id })
      if (!dep) {
        const p = (mode() && await mollie('get', `/payments/${id}`).catch(() => null)) || (orgKey() && await mollie('get', `/payments/${id}`, null, null, { profileId: 'org' }).catch(() => null)) || null
        const d = p?.metadata?.ref && await deposits.findOne({ ref: String(p.metadata.ref), provider: 'mollie', mollieSessionId: { $exists: true } })
        if (d) { await deposits.updateOne({ _id: d._id }, { $set: { molliePaymentId: id } }); dep = { ...d, molliePaymentId: id } }
      }
      if (dep) await sync(dep).catch(e => { log(`[Mollie] webhook ${id}: ${e.message}`); throw e })
      res.status(200).send('ok')
    }))
  }

  function routes(router, { h }) {
    router.get('/wallet/mollie/options', h(async (req, res) => {
      if (!enabled() || !(await checkDomain(siteOf(req)))) return res.json({ enabled: false, currencies: [], comingSoon: true })
      res.json(await options(req.query.amountUsd, await via(siteOf(req))))
    }))
    router.post('/wallet/mollie/pay', h(async (req, res) => {
      if (!enabled() || !(await checkDomain(siteOf(req)))) return res.status(424).json({ error: 'mollie_off', message: 'Card payments are coming soon.' })
      const amountUsd = round2(req.body.amountUsd), currency = String(req.body.currency || 'USD').toUpperCase(), method = req.body.method ? String(req.body.method) : null
      if (!(amountUsd >= MIN_TOPUP_USD) || amountUsd > 10000) return res.status(400).json({ error: 'invalid_amount', message: `Top up between $${MIN_TOPUP_USD} and $10,000.` })
      const v = await via(siteOf(req))
      const opt = (await options(amountUsd, v)).currencies.find(c => c.currency === currency)
      if (!opt) return res.status(400).json({ error: 'invalid_currency', message: 'That currency is not available. Pick another one.' })
      if (method && !opt.methods.some(m => m.id === method)) return res.status(400).json({ error: 'invalid_method', message: 'That payment method is not available for this currency.' })
      const back = String(req.body.returnUrl || ''), origin = String(req.get('origin') || '')
      if (!origin || !back.startsWith(`${origin}/`)) return res.status(400).json({ error: 'invalid_return', message: 'Open the payment from the CloudIVR app.' })
      const ref = `mol_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const offers = getOffers?.(), bonus = offers ? await offers.topupBonusFor(req.webChatId).catch(() => null) : null
      const dep = { chatId: req.webChatId, ref, amountUsd, coin: 'Card / PayPal', provider: 'mollie', mode: modeOf(v), mollieProfile: v.profileId || null, currency, amountCharged: opt.amount, method, bonus, bonusPaidAt: null, createdAt: new Date() }
      const { insertedId } = await deposits.insertOne(dep)
      let p
      try {
        p = await mollie('post', '/payments', {
          amount: { currency, value: opt.amount }, description: `CloudIVR wallet top-up $${amountUsd.toFixed(2)}`,
          redirectUrl: `${back}${back.includes('?') ? '&' : '?'}mollie=${ref}`, cancelUrl: `${back}${back.includes('?') ? '&' : '?'}mollie=${ref}`,
          webhookUrl: `${process.env.SELF_URL}/cloudivr-web/mollie/webhook`, metadata: { ref, chatId: String(req.webChatId) }, ...(method ? { method } : {}),
        }, `cloudivr-${ref}`, v)
      } catch (e) {
        await deposits.updateOne({ _id: insertedId }, { $set: { mollieStatus: 'error', mollieError: String(e.response?.data?.detail || e.message).slice(0, 300) } })
        log(`[Mollie] create failed ${ref}: ${e.response?.data?.detail || e.message}`)
        if (notApproved(e.response?.data?.detail)) markSite(siteOf(req), false, String(e.response.data.detail))
        if (Date.now() - lastFailAlert > 3600000) { lastFailAlert = Date.now(); notifyAdmin?.(`⚠️ <b>Mollie checkout could not start</b> for web account ${req.webChatId}: ${String(e.response?.data?.detail || e.message).replace(/</g, '&lt;')}${/redirect URL/i.test(e.response?.data?.detail || '') ? '\nAdd this site’s domain to your Mollie website profile (Dashboard → Settings → Website profiles).' : ''}`) }
        return res.status(424).json({ error: 'mollie_error', message: 'The card payment service did not answer. Try again or pick another method.' })
      }
      await deposits.updateOne({ _id: insertedId }, { $set: { molliePaymentId: p.id, mollieStatus: p.status } })
      res.status(201).json({ ref, checkoutUrl: p._links?.checkout?.href, amountUsd, currency, amount: opt.amount, mode: modeOf(v) })
    }))
    // In-app checkout: a Checkout Session whose client token mounts Mollie's card / express / methods components on our page.
    router.post('/wallet/mollie/session', h(async (req, res) => {
      if (!enabled() || !(await checkDomain(siteOf(req)))) return res.status(424).json({ error: 'mollie_off', message: 'Card payments are coming soon.' })
      const amountUsd = round2(req.body.amountUsd), currency = String(req.body.currency || 'USD').toUpperCase()
      if (!(amountUsd >= MIN_TOPUP_USD) || amountUsd > 10000) return res.status(400).json({ error: 'invalid_amount', message: `Top up between $${MIN_TOPUP_USD} and $10,000.` })
      const v = await via(siteOf(req))
      const opt = (await options(amountUsd, v)).currencies.find(c => c.currency === currency)
      if (!opt) return res.status(400).json({ error: 'invalid_currency', message: 'That currency is not available. Pick another one.' })
      const back = String(req.body.returnUrl || ''), origin = String(req.get('origin') || '')
      if (!origin || !back.startsWith(`${origin}/`)) return res.status(400).json({ error: 'invalid_return', message: 'Open the payment from the CloudIVR app.' })
      const ref = `mol_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const offers = getOffers?.(), bonus = offers ? await offers.topupBonusFor(req.webChatId).catch(() => null) : null
      const money = { currency, value: opt.amount }, description = `CloudIVR wallet top-up $${amountUsd.toFixed(2)}`
      const dep = { chatId: req.webChatId, ref, amountUsd, coin: 'Card / PayPal', provider: 'mollie', mode: modeOf(v), mollieProfile: v.profileId || null, currency, amountCharged: opt.amount, method: null, inApp: true, bonus, bonusPaidAt: null, createdAt: new Date() }
      const { insertedId } = await deposits.insertOne(dep)
      let s
      try {
        s = await mollie('post', '/sessions', {
          amount: money, description, lines: [{ type: 'digital', description: 'CloudIVR wallet credit', quantity: 1, unitPrice: money, totalAmount: money }],
          redirectUrl: `${back}${back.includes('?') ? '&' : '?'}mollie=${ref}`, payment: { webhookUrl: `${process.env.SELF_URL}/cloudivr-web/mollie/webhook` }, metadata: { ref, chatId: String(req.webChatId) },
        }, `cloudivr-sess-${ref}`, v)
      } catch (e) {
        const why = String(e.response?.data?.detail || e.message)
        await deposits.deleteOne({ _id: insertedId })
        log(`[Mollie] session failed ${ref}: ${why}`)
        if (notApproved(why)) markSite(siteOf(req), false, why)
        if (Date.now() - lastFailAlert > 3600000) { lastFailAlert = Date.now(); notifyAdmin?.(`⚠️ <b>Mollie in-app checkout could not start</b> for web account ${req.webChatId}: ${why.replace(/</g, '&lt;')}${/redirect URL/i.test(why) ? '\nAdd this site’s domain to your Mollie website profile (Dashboard → Settings → Website profiles).' : ''}`) }
        return res.status(424).json({ error: 'mollie_error', message: 'Paying inside the app isn’t available right now. Use Mollie’s secure payment page below.', fallback: true })
      }
      await deposits.updateOne({ _id: insertedId }, { $set: { mollieSessionId: s.id, mollieStatus: 'open' } })
      res.status(201).json({ ref, clientAccessToken: s.clientAccessToken, amountUsd, currency, amount: opt.amount, mode: modeOf(v) })
    }))
    router.get('/wallet/mollie/:ref', h(async (req, res) => {
      const dep = await deposits.findOne({ ref: String(req.params.ref), chatId: req.webChatId, provider: 'mollie' })
      if (!dep) return res.status(404).json({ error: 'not_found', message: 'Payment not found.' })
      const s = await sync(dep).catch(() => ({ status: dep.mollieStatus || 'open' }))
      res.json({ ref: dep.ref, status: s.status, amountUsd: dep.amountUsd, currency: dep.currency, amount: dep.amountCharged })
    }))
  }

  return { enabled, options, sync, settle, refund, routes, publicRoutes, checkDomain, sites, cardsLive }
}

module.exports = { createMollie, CURRENCIES, mode }
