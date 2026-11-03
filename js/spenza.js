'use strict'
// Spenza Partner API: eSIM lines resold in CloudIVR (paid from the USD wallet), admin fleet view,
// inbound SMS → Inbox, outbound SMS, and optional call routing to CloudIVR via Spenza's SIP gateway.
// Preview (WEB_CLOUDIVR_DRY_RUN=true): purchases and SIP changes are simulated; texts on real lines are real.
const axios = require('axios')
const crypto = require('crypto')
const { walletOps, round2 } = require('./cloudivr-web/wallet')

const API = 'https://api.spenza.com'
const MONTH_MS = 30 * 86400000
const TEXT_PRICE = 0.05
const dry = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
let S = null
let tok = { value: null, exp: 0 }

async function token() {
  if (tok.value && Date.now() < tok.exp - 60000) return tok.value
  const r = await axios.post(`${API}/api/v1.1/auth/token`, { key: process.env.SPENZA_API_KEY, secret: process.env.SPENZA_API_SECRET }, { timeout: 15000 })
  tok = { value: r.data.data.access_token, exp: new Date(r.data.data.expires_at).getTime() }
  return tok.value
}
async function call(method, path, data, extra = {}) {
  const go = async () => axios({ method, url: API + path, data, timeout: 30000, headers: { Authorization: `Bearer ${await token()}`, ...extra } })
  try { return (await go()).data } catch (e) {
    if (e.response?.status === 401 && !extra._retried) { tok = { value: null, exp: 0 }; return call(method, path, data, { ...extra, _retried: true }) }
    const err = new Error(e.response?.data?.error?.message || e.response?.data?.message || e.message)
    err.code = e.response?.data?.error?.code; err.status = e.response?.status
    throw err
  }
}
// Telegram-bot buyers (non-web chat ids) get every notice in their bot chat; web accounts in the CloudIVR inbox.
const isBot = (id) => !!S?.bot && !require('./cloudivr-web/notify').isWebChatId(id)
// Bot buyers' later notices in their own language (esim-bot.notice); web lines keep the English text.
const bt = (d, key, ...a) => (isBot(d.chatId) ? (S.notice || require('./esim-bot').notice)(d.lang, key, ...a) : null)
const say = (id, text, extra) => isBot(id) ? S.bot.sendMessage(id, text, { disable_web_page_preview: true }).catch(e => S.log(`[eSIM] bot notice ${id}: ${e.message}`)) : S.tell(id, text, extra)
const unwrap = (r) => (Array.isArray(r?.data) ? r.data : r?.data?.items || r?.data || [])
const FRIENDLY = 'The eSIM service didn’t respond. Try again in a minute.'
const errOf = (e) => { S?.log(`[eSIM] provider: ${e.message}`); return { error: FRIENDLY } }
const custPlan = (p) => ({ planId: p.planId, label: p.label ? String(p.label).replace(/\bUS\b/g, 'USA') : null, price: p.price, validityDays: p.validityDays, data: p.data, voiceMinutes: p.voiceMinutes, sms: p.sms, carrier: 'T-Mobile network' })

const planOut = (p, cfg, sim) => ({
  planId: p.productId, cost: p.price, simId: sim?.simId || null, simCost: sim?.price ?? null, lineCost: round2((p.price || 0) + (sim?.price || 0)), currency: p.currency, validityDays: p.validityDays, recurring: !!p.recurring,
  data: p.data ? `${p.data.value} ${p.data.unit}` : null, voiceMinutes: p.voiceMinutes ?? null,
  sms: p.smsCount == null ? null : p.smsCount >= 999999 ? 'Unlimited' : p.smsCount,
  operator: p.operator, network: p.network, isEsim: !!p.isEsim, planType: p.planType,
  price: cfg?.price ?? null, enabled: !!cfg?.enabled, label: cfg?.label || null,
})

// ---------- catalog (admin sets price + enabled per plan) ----------
async function catalog() {
  const [plans, cfgs, prods] = await Promise.all([call('get', '/api/v1.1/plans?page=1&pageSize=100'), S.db.collection('esimPlans').find().toArray(), call('get', '/api/v1.1/sim-products?page=1&pageSize=100')])
  const by = Object.fromEntries(cfgs.map(c => [c._id, c]))
  return unwrap(plans).map(p => planOut(p, by[p.productId], simFor(p, unwrap(prods))))
}
async function setPlan(planId, { price, enabled, label }) {
  const p = Number(price)
  if (enabled && !(p > 0)) return { error: 'Set a customer price above $0 before turning this plan on.' }
  await S.db.collection('esimPlans').updateOne({ _id: String(planId) }, { $set: { price: p > 0 ? round2(p) : null, enabled: !!enabled, label: label ? String(label).slice(0, 60) : null, updatedAt: new Date() } }, { upsert: true })
  return { ok: true }
}
// The line product an eSIM order needs (required simId): same carrier, eSIM + in stock first; env can pin one.
function simFor(plan, prods) {
  if (process.env.SPENZA_ESIM_SIM_ID) return prods.find(x => x.simId === process.env.SPENZA_ESIM_SIM_ID) || { simId: process.env.SPENZA_ESIM_SIM_ID, price: null }
  const same = prods.filter(x => x.operator === plan.operator)
  return [...same].sort((a, b) => (b.isEsim - a.isEsim) || ((b.inStock > 0) - (a.inStock > 0)))[0] || null
}
async function forSale() { return (await catalog()).filter(p => p.enabled && p.price > 0) }
async function plansForCustomers() { return (await forSale()).map(custPlan) }

// ---------- admin fleet ----------
async function fleet() {
  const [sims, credit, prods, lines] = await Promise.all([
    call('get', '/api/v1.1/sims?page=1&pageSize=100'), call('get', '/api/v1.1/credit-balance'),
    call('get', '/api/v1.1/sim-products?page=1&pageSize=50'), S.col.find({}, { projection: { iccid: 1, chatId: 1, status: 1 } }).toArray(),
  ])
  const owner = Object.fromEntries(lines.filter(l => l.iccid).map(l => [l.iccid, l]))
  return {
    credit: (credit?.data?.creditBalance || []).map(c => ({ currency: c.currency, amount: c.amount })),
    simProducts: unwrap(prods).map(p => ({ simId: p.simId, price: p.price, isEsim: !!p.isEsim, inStock: p.inStock, operator: p.operator })),
    sims: unwrap(sims).map(s => ({ iccid: s.iccid, phoneNumber: s.phoneNumber, status: s.status, isEsim: !!s.isEsim, operator: s.operator, assignedTo: s.assignedTo?.email || null, device: s.device?.model || null, linkedTo: owner[s.iccid]?.chatId || null })),
    sip: await S.db.collection('spenzaConfig').findOne({ _id: 'sip' }, { projection: { _id: 0, at: 1, ip: 1, numbers: 1, pending: 1 } }),
    webhook: await S.db.collection('spenzaConfig').findOne({ _id: 'webhook' }, { projection: { _id: 0, at: 1, url: 1, id: 1 } }),
  }
}
async function usage(iccid) {
  try { return { usage: (await call('get', `/api/v1.1/sims/${encodeURIComponent(iccid)}/usage`))?.data || null } } catch (e) { return errOf(e) }
}

// Admin: attach an existing Spenza SIM to a CloudIVR account (e.g. the test eSIM), no charge.
async function linkSim(iccid, email, kind) {
  const acct = await S.db.collection('webAccounts').findOne({ email: String(email || '').trim().toLowerCase() }, { projection: { _id: 1 } })
  if (!acct) return { error: 'No CloudIVR account with that email.' }
  const sim = unwrap(await call('get', '/api/v1.1/sims?page=1&pageSize=100')).find(s => s.iccid === iccid)
  if (!sim) return { error: 'That SIM isn’t on your Spenza account.' }
  const sub = await call('get', `/api/v1.1/sims/${encodeURIComponent(iccid)}/subscription`).catch(() => null)
  const _id = 'es_' + crypto.randomBytes(6).toString('hex')
  await S.col.updateOne({ iccid }, { $set: { chatId: String(acct._id), iccid, phoneNumber: sim.phoneNumber || null, isEsim: !!sim.isEsim, planId: sub?.data?.productId || sub?.data?.planId || null, status: 'active', price: 0, linked: true, ...(kind === 'mobile' ? { kind: 'mobile', callsTo: 'device', ivrNumber: null } : {}), updatedAt: new Date() }, $setOnInsert: { _id, callsTo: 'device', createdAt: new Date() } }, { upsert: true })
  return { ok: true }
}

// ---------- customer lines ----------
const pub = (d) => ({ numberChange: d.numberChange ? { status: d.numberChange.status, at: d.numberChange.at, oldNumber: d.numberChange.oldNumber, newNumber: d.numberChange.newNumber || null } : null, formerNumbers: (d.formerNumbers || []).map(f => f.phone), autoRenew: d.autoRenew !== false, id: d._id, iccid: d.iccid || null, phoneNumber: d.phoneNumber || null, planId: d.planId, price: d.price, status: d.status, note: d.note || null, callsTo: d.callsTo || 'device', ivrNumber: d.ivrNumber || null, nextBillAt: d.nextBillAt || null, expiresAt: d.expiresAt || null, createdAt: d.createdAt, linked: !!d.linked, kind: d.kind || 'esim', zipcode: d.zipcode || null, hasQr: d.kind !== 'mobile' && !!(d.qrCode || d.iccid), qrEmail: d.qrEmail || null, qrEmailedAt: d.qrEmailedAt || null })
const luhn = (s) => { let sum = 0; for (let i = 0; i < s.length; i++) { let n = +s[s.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9 } sum += n } return sum % 10 === 0 }
const txn = (chatId, type, amount, meta) => S.db.collection('transactions').insertOne({ chatId: String(chatId), type, amount: round2(amount), currency: 'USD', status: 'completed', metadata: { ...meta, channel: 'esim' }, createdAt: new Date(), updatedAt: new Date() })

async function list(chatId, kind = 'esim') { return (await S.col.find({ chatId: String(chatId), status: { $ne: 'cancelled' }, kind: kind === 'mobile' ? 'mobile' : { $ne: 'mobile' } }).sort({ createdAt: -1 }).toArray()).map(pub) }
async function mine(chatId, id) { return S.col.findOne({ _id: String(id), chatId: String(chatId) }) }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
// Each CloudIVR buyer is a Spenza user (end user) holding their lines. Spenza needs an email: the account's,
// or a private CloudIVR address for phone-only accounts (swapped for the real one once they add it).
const privateEmail = (chatId) => `u${chatId}@users.${String(process.env.CLOUDIVR_WEB_DOMAIN || '').trim().toLowerCase() || 'cloudivr.net'}`
// Bot buyers have no web account: the email they gave at checkout (if any) is their Spenza user email.
async function spenzaUser(chatId, botEmail) {
  const acc = await S.db.collection('webAccounts').findOne({ _id: { $in: [String(chatId), Number(chatId)] } }, { projection: { email: 1, name: 1, phone: 1 } })
  const email = acc?.email || botEmail || privateEmail(chatId)
  return { email, name: String(acc?.name || '').trim() || 'CloudIVR customer', private: !acc?.email && !botEmail, ...(acc?.phone ? { phoneNumber: acc.phone.replace(/^\+1/, '').replace(/\D/g, '') } : {}) }
}
const botEmailOf = (d) => d.source === 'telegram' ? d.qrEmail || null : null
// Assign one line's SIM to its owner's Spenza user (creates the user if new). Recorded on the line and the account.
async function linkUser(d) {
  const u = await spenzaUser(d.chatId, botEmailOf(d))
  if (d.spenzaUser?.email === u.email && d.spenzaUser?.linkedAt) return true
  if (real(d)) await call('post', `/api/v1.1/sims/${encodeURIComponent(d.iccid)}/assign`, { email: u.email, name: u.name })
  const rec = { email: u.email, private: u.private, linkedAt: new Date() }
  await S.col.updateOne({ _id: d._id }, { $set: { spenzaUser: rec } })
  await S.db.collection('webAccounts').updateOne({ _id: { $in: [String(d.chatId), Number(d.chatId)] } }, { $set: { spenzaUser: { email: u.email, private: u.private, at: new Date() } } })
  return true
}
// Account email added/changed: move every line to the Spenza user for the new email.
async function syncUser(chatId) {
  for (const d of await S.col.find({ chatId: String(chatId), status: { $in: ['active', 'suspended'] }, iccid: { $ne: null } }).toArray()) await linkUser(d).catch(e => S.log(`[Spenza] user sync ${d._id}: ${e.message}`))
}
async function buy(chatId, { planId, imei, zipcode, email, autoRenew, source, lang }) {
  const bot = source === 'telegram' && !require('./cloudivr-web/notify').isWebChatId(chatId)
  const qrEmail = String(email || '').trim().toLowerCase()
  if ((!bot || qrEmail) && !EMAIL_RE.test(qrEmail)) return { error: 'Enter the email address where we should send your eSIM QR code.' }
  const im = String(imei || '').replace(/\D/g, '')
  // Telegram buyers may pay first and send the IMEI afterwards (the line waits in 'awaiting_imei').
  const later = bot && !im
  if (!later && (im.length !== 15 || !luhn(im))) return { error: 'Enter your phone’s 15-digit IMEI (dial *#06# to see it).' }
  const zip = String(zipcode || '').trim()
  if (zip && !/^\d{5}$/.test(zip)) return { error: 'Enter a 5-digit USA ZIP code, or leave it empty.' }
  const plan = (await forSale()).find(p => p.planId === planId)
  if (!plan) return { error: 'That plan isn’t available.' }
  if (!plan.simId) return { error: 'eSIMs are temporarily unavailable. Try again later.' }
  if (!(await S.w.debit(chatId, plan.price))) return { error: `Your wallet needs $${plan.price} for this eSIM. Top up first.`, code: 'insufficient_balance' }
  const _id = 'es_' + crypto.randomBytes(6).toString('hex')
  const doc = { _id, chatId: String(chatId), planId, price: plan.price, imei: im || null, zipcode: zip || null, simId: plan.simId, qrEmail: qrEmail || null, autoRenew: autoRenew !== false, status: later ? 'awaiting_imei' : 'provisioning', callsTo: 'device', ...(bot ? { source: 'telegram', lang: ['en', 'fr', 'hi', 'zh'].includes(lang) ? lang : 'en' } : {}), createdAt: new Date(), updatedAt: new Date() }
  await S.col.insertOne(doc)
  await txn(chatId, 'esim-purchase', plan.price, { planId, lineId: _id })
  if (later) return { item: pub(doc), awaitingImei: true }
  return provision(doc)
}

// A bot order whose line was refunded shows as refunded in order reports.
const orderRefunded = (lineId) => S.db.collection('digitalOrders').updateOne({ esimLineId: lineId }, { $set: { status: 'refunded', refundedAt: new Date() } }).catch(() => {})
// Send the paid line to Spenza; refund the wallet if Spenza refuses.
async function provision(doc) {
  const { _id, chatId, price, simId, planId, imei: im, zipcode: zip } = doc
  if (dry()) { await S.col.updateOne({ _id }, { $set: { transactionId: 'preview-' + _id, simulated: true } }); return { item: pub(doc) } }
  try {
    const u = await spenzaUser(chatId, doc.source === 'telegram' ? doc.qrEmail || null : null)
    const r = await call('post', '/api/v1.1/esim', { imei: im, simId, planId, activateNow: true, email: u.email, user: { name: u.name, email: u.email, ...(u.phoneNumber ? { phoneNumber: u.phoneNumber } : {}), ...(zip ? { zipcode: zip } : {}) }, ...(zip ? { zipcode: zip } : {}) }, { 'Idempotency-Key': _id })
    await S.col.updateOne({ _id }, { $set: { transactionId: r?.data?.transactionId || r?.transactionId, spenzaUser: { email: u.email, private: u.private } } })
    return { item: pub(doc) }
  } catch (e) {
    await S.w.credit(chatId, price); await txn(chatId, 'esim-refund', price, { lineId: _id })
    orderRefunded(_id)
    S.log(`[eSIM] create ${_id}: ${e.message}`)
    await S.col.updateOne({ _id }, { $set: { status: 'failed', note: 'The eSIM couldn’t be created. Your payment was refunded.', providerError: e.message, updatedAt: new Date() } })
    say(chatId, bt({ chatId, lang: doc.lang }, 'failed', price) || `⚠️ Your eSIM couldn’t be created. $${price} was refunded to your wallet.`, { kind: 'billing', meta: { esim: _id } })
    return { error: `We couldn’t create the eSIM right now. Your $${price} was refunded to your wallet.`, code: 'esim_failed' }
  }
}

// IMEI sent after payment: claim the waiting line once, then create the eSIM.
async function submitImei(chatId, lineId, imei) {
  const im = String(imei || '').replace(/\D/g, '')
  if (im.length !== 15 || !luhn(im)) return { error: 'Enter your phone’s 15-digit IMEI (dial *#06# to see it).' }
  const doc = await S.col.findOneAndUpdate({ _id: lineId, chatId: String(chatId), status: 'awaiting_imei' }, { $set: { imei: im, status: 'provisioning', provisionStartedAt: new Date(), updatedAt: new Date() } }, { returnDocument: 'after' })
  const d = doc?.value !== undefined ? doc.value : doc
  if (!d) return { error: 'This eSIM order is no longer waiting for an IMEI.' }
  return provision(d)
}

const IMEI_WAIT_MS = 7 * 86400000
// Paid lines still without an IMEI: a reminder each day, refund to the wallet after 7 days.
async function imeiChase() {
  const now = Date.now()
  for (const d of await S.col.find({ status: 'awaiting_imei', createdAt: { $lte: new Date(now - IMEI_WAIT_MS) } }).limit(50).toArray()) {
    const r = await S.col.updateOne({ _id: d._id, status: 'awaiting_imei' }, { $set: { status: 'cancelled', note: 'No IMEI sent within 7 days. Your payment was refunded.', updatedAt: new Date() } })
    if (!r.modifiedCount) continue
    await S.w.credit(d.chatId, d.price); await txn(d.chatId, 'esim-refund', d.price, { lineId: d._id, reason: 'no_imei' })
    await S.db.collection('digitalOrders').updateOne({ esimLineId: d._id }, { $set: { status: 'refunded_no_imei', refundedAt: new Date() } }).catch(() => {})
    say(d.chatId, bt(d, 'imeiRefund', d.price) || `↩️ Your eSIM order was cancelled because no IMEI was sent within 7 days. $${d.price} was refunded to your wallet.`, { kind: 'billing', meta: { esim: d._id } })
  }
  for (const d of await S.col.find({ status: 'awaiting_imei', createdAt: { $lte: new Date(now - DAY_MS) }, imeiRemindedAt: { $not: { $gt: new Date(now - DAY_MS) } } }).limit(50).toArray()) {
    await S.col.updateOne({ _id: d._id }, { $set: { imeiRemindedAt: new Date() } })
    const left = Math.max(1, Math.ceil((new Date(d.createdAt).getTime() + IMEI_WAIT_MS - now) / DAY_MS))
    say(d.chatId, bt(d, 'imeiRemind', left, d.price) || `📟 Your paid eSIM is waiting for your phone’s IMEI. Open 📋 My eSIMs to send it. If it isn’t sent within ${left} day(s), $${d.price} goes back to your wallet.`)
  }
}

// ---------- USA mobile number for texting ($75/month): an eSIM line held by CloudIVR, number shown once assigned ----------
const MOBILE_PRICE = 75
// No customer phone for a virtual number: use the IMEI of the owner's own line (env override → the owner's prelinked line on Spenza).
// Never a customer's device. A miss is cached for 10 minutes so the public offer endpoint doesn't hit Spenza each time.
let imeiMiss = 0
async function mobileImei() {
  if (dry()) return '356938035643809'
  const ok = (v) => { const x = String(v || '').replace(/\D/g, ''); return x.length === 15 ? x : null }
  if (ok(process.env.SPENZA_TEXT_LINE_IMEI)) return ok(process.env.SPENZA_TEXT_LINE_IMEI)
  const cfg = await S.db.collection('spenzaConfig').findOne({ _id: 'mobileImei' })
  if (ok(cfg?.imei)) return cfg.imei
  if (Date.now() - imeiMiss < 10 * 60000) return ''
  const r = await call('get', '/api/v1.1/sims?page=1&pageSize=100').catch(() => null)
  const own = new Set(PRELINK.map(x => x.phone))
  const imei = (r?.data?.items || r?.data || []).filter(x => own.has(x.phoneNumber) && x.status === 'ACTIVE').map(x => ok(x.device?.imei || x.imei)).find(Boolean) || null
  if (!imei) { imeiMiss = Date.now(); return '' }
  await S.db.collection('spenzaConfig').updateOne({ _id: 'mobileImei' }, { $set: { imei, at: new Date() } }, { upsert: true })
  return imei
}
async function mobileOffer() {
  const plan = (await forSale().catch(() => [])).find(p => p.simId)
  return { available: !!plan && (await mobileImei()).length === 15, price: MOBILE_PRICE }
}
async function buyMobile(chatId, { zipcode, autoRenew }) {
  const zip = String(zipcode || '').trim()
  if (!/^\d{5}$/.test(zip)) return { error: 'Enter a 5-digit USA ZIP code so we can ask for a number near it.' }
  const im = await mobileImei()
  const plan = (await forSale()).find(p => p.simId)
  if (!plan || im.length !== 15) return { error: 'USA mobile numbers are temporarily unavailable. Try again later.' }
  if (!(await S.w.debit(chatId, MOBILE_PRICE))) return { error: `Your wallet needs $${MOBILE_PRICE} for this number. Top up first.`, code: 'insufficient_balance' }
  const _id = 'mn_' + crypto.randomBytes(6).toString('hex')
  const doc = { _id, kind: 'mobile', chatId: String(chatId), planId: plan.planId, price: MOBILE_PRICE, imei: im, zipcode: zip, simId: plan.simId, autoRenew: autoRenew !== false, status: 'provisioning', callsTo: 'device', createdAt: new Date(), updatedAt: new Date() }
  await S.col.insertOne(doc)
  await txn(chatId, 'mobile-number-purchase', MOBILE_PRICE, { lineId: _id, zipcode: zip })
  if (dry()) { await S.col.updateOne({ _id }, { $set: { transactionId: 'preview-' + _id, simulated: true } }); return { item: pub(doc) } }
  try {
    const u = await spenzaUser(chatId)
    const r = await call('post', '/api/v1.1/esim', { imei: im, simId: plan.simId, planId: plan.planId, activateNow: true, zipcode: zip, email: u.email, user: { name: u.name, email: u.email, zipcode: zip, ...(u.phoneNumber ? { phoneNumber: u.phoneNumber } : {}) } }, { 'Idempotency-Key': _id })
    await S.col.updateOne({ _id }, { $set: { transactionId: r?.data?.transactionId || r?.transactionId, spenzaUser: { email: u.email, private: u.private } } })
    return { item: pub(doc) }
  } catch (e) {
    await S.w.credit(chatId, MOBILE_PRICE); await txn(chatId, 'mobile-number-refund', MOBILE_PRICE, { lineId: _id })
    S.log(`[mobile] create ${_id}: ${e.message}`)
    if (/imei/i.test(e.message)) await S.db.collection('spenzaConfig').deleteOne({ _id: 'mobileImei' })
    await S.col.updateOne({ _id }, { $set: { status: 'failed', note: 'The number couldn’t be set up. Your payment was refunded.', providerError: e.message, updatedAt: new Date() } })
    return { error: `We couldn’t set up the number right now. Your $${MOBILE_PRICE} was refunded to your wallet.`, code: 'mobile_failed' }
  }
}
const CID = () => require('./cloudivr-web/caller-ids')
async function ready(d, phone) {
  if (d.kind !== 'mobile') return
  await say(d.chatId, `📱 Your USA mobile number is ready: ${phone || ''}. It has two-way SMS: send and receive texts in Messages.`, { kind: 'billing', meta: { mobile: d._id } })
  if (!phone) return
  const r = await CID().autoVerify(S.db, d.chatId, phone).catch(e => { S.log(`[mobile] caller ID ${d._id}: ${e.message}`); return null })
  if (r === 'verified') await say(d.chatId, `✅ ${phone} is now one of your caller IDs, free. Pick it as “Show as” on calls and campaigns.`, { kind: 'system', meta: { mobile: d._id } })
}

// Browser-phone login for a USA mobile number: calls go out through Telnyx showing this number (wallet per minute).
async function mobileSip(chatId, phone) {
  const d = await S.col.findOne({ chatId: String(chatId), kind: 'mobile', phoneNumber: phone, status: 'active' })
  if (!d) return null
  if (d.sip?.username) return d.sip
  let sip
  if (d.simulated) sip = { username: 'mnsip' + d._id.slice(3), password: crypto.randomBytes(9).toString('hex'), live: false }
  else {
    const c = await require('./telnyx-service').createSIPCredential(process.env.TELNYX_SIP_CONNECTION_ID, 'mn' + crypto.randomBytes(6).toString('hex'), crypto.randomBytes(12).toString('hex'), phone)
    if (!c?.sip_username) return { error: 'We couldn’t set up calling for this number right now. Try again in a minute.' }
    sip = { username: c.sip_username, password: c.sip_password, credId: c.id || null, live: true }
  }
  await S.col.updateOne({ _id: d._id }, { $set: { sip, updatedAt: new Date() } })
  return sip
}
const dropSip = (d) => d.sip?.credId ? require('./telnyx-service').deleteSIPCredential(d.sip.credId).catch(() => {}) : null

// Poll provisioning; a finished one gets its number, ICCID and QR.
async function pollOne(d) {
  if (d.simulated) {
    if (Date.now() - new Date(d.provisionStartedAt || d.createdAt).getTime() < 20000) return
    const iccid = '8901' + String(Date.now()).slice(-15)
    const phone = '+1555' + String(Date.now()).slice(-7)
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'active', iccid, phoneNumber: phone, qrCode: `LPA:1$preview.spenza.test$${d._id}`, ...period(new Date(Date.now() + MONTH_MS)), updatedAt: new Date() } })
    return d.kind === 'mobile' ? ready(d, phone) : isBot(d.chatId) ? botReady({ ...d, phoneNumber: phone }) : emailQr({ ...d, phoneNumber: phone })
  }
  const r = await axios.get(`${API}/api/v3/transactions/${encodeURIComponent(d.transactionId)}`, { timeout: 15000 }).then(x => x.data?.data).catch(() => null)
  const st = String(r?.status || '').toLowerCase()
  if (['completed', 'succeeded', 'success'].includes(st)) {
    const x = r.result || {}
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'active', iccid: x.iccid || null, phoneNumber: x.mdn ? (String(x.mdn).startsWith('+') ? x.mdn : '+1' + String(x.mdn).replace(/\D/g, '').slice(-10)) : null, qrCode: x.qrCode || null, orderId: x.orderId || null, providerResult: x, ...period((x.iccid && await subEnd(x.iccid, d._id)) || new Date(Date.now() + MONTH_MS)), updatedAt: new Date() } })
    if (d.kind === 'mobile') return ready(d, x.mdn ? '+1' + String(x.mdn).replace(/\D/g, '').slice(-10) : null)
    if (isBot(d.chatId)) return botReady({ ...d, phoneNumber: x.mdn ? '+1' + String(x.mdn).replace(/\D/g, '').slice(-10) : null })
    const sent = await emailQr({ ...d, phoneNumber: x.mdn || null })
    say(d.chatId, `📱 Your eSIM is ready. Open CloudIVR eSIM and scan the QR code with your phone to install it. It has two-way SMS: send and receive texts on that phone.${sent ? ` We also emailed it to ${d.qrEmail}.` : ''}`, { kind: 'billing', meta: { esim: d._id } })
  } else if (['failed', 'error'].includes(st) || Date.now() - new Date(d.provisionStartedAt || d.createdAt).getTime() > 86400000) {
    await S.w.credit(d.chatId, d.price); await txn(d.chatId, 'esim-refund', d.price, { lineId: d._id })
    orderRefunded(d._id)
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'failed', note: 'The eSIM couldn’t be created. Your payment was refunded.', providerError: r?.error?.message || (st ? null : 'timed out after 24 h'), updatedAt: new Date() } })
    say(d.chatId, bt(d, 'failed', d.price) || (d.kind === 'mobile' ? `⚠️ Your USA mobile number couldn’t be set up. $${d.price} was refunded to your wallet.` : `⚠️ Your eSIM couldn’t be created. $${d.price} was refunded to your wallet.`), { kind: 'billing', meta: d.kind === 'mobile' ? { mobile: d._id } : { esim: d._id } })
  }
}

// The QR code goes only to the app (or the bot chat) and to the email given at checkout.
const INSTALL = 'On the phone that will use it: Settings → Mobile / Cellular → Add eSIM → Use QR code, then scan the QR code. Keep the phone on Wi-Fi while it installs. Each QR code can be installed once.'
async function qrPng(d) {
  const got = await qr(d.chatId, d._id).catch(() => ({}))
  const code = got?.qrCode || null
  if (!code && !got?.image) return null
  return { code, png: code ? await require('qrcode').toBuffer(code, { width: 360, margin: 2 }) : Buffer.from(got.image.split(',')[1], 'base64') }
}
// Bot buyer: QR image in the chat (and by email if they gave one).
async function sendBotQr(d) {
  const q = await qrPng(d)
  if (!q) return false
  const caption = bt(d, 'caption', d.phoneNumber, q.code) || `📱 Your USA T-Mobile eSIM${d.phoneNumber ? ` ${d.phoneNumber}` : ''}\n\n${INSTALL}${q.code ? `\n\nManual code: ${q.code}` : ''}`
  await S.bot.sendPhoto(d.chatId, q.png, { caption: caption.slice(0, 1024) }, { filename: 'esim-qr.png', contentType: 'image/png' })
  return true
}
async function botReady(d) {
  const sent = d.qrEmail ? await emailQr(d) : false
  await say(d.chatId, bt(d, 'ready', d.phoneNumber, sent ? d.qrEmail : null, !!d.qrEmail))
  await sendBotQr(d).catch(e => S.log(`[eSIM] bot QR ${d._id}: ${e.message}`))
}
async function emailQr(d) {
  if (!d.qrEmail) return false
  const q = await qrPng(d)
  if (!q) return false
  const { code, png } = q
  const bot = d.source === 'telegram'
  const html = `<p>Your ${bot ? 'USA T-Mobile' : 'CloudIVR'} eSIM${d.phoneNumber ? ` for <b>${d.phoneNumber}</b>` : ''} is ready.</p><p>${INSTALL.replace('scan the QR code', 'scan the attached QR code')}</p><p>Once installed, the line has two-way SMS on that phone: send and receive texts, plus calls and USA data.</p>${code ? `<p>Manual code: <code>${code}</code></p>` : ''}<p>${bot ? 'You can also see the QR code any time in the Telegram bot: Digital Products → USA T-Mobile eSIM → My eSIMs.' : 'You can also open the QR code any time in the CloudIVR app under CloudIVR eSIM.'}</p>`
  const ok = await require('./cloudivr-web/auth').sendMail(d.qrEmail, bot ? 'Your eSIM QR code' : 'Your CloudIVR eSIM QR code', html, [{ filename: 'esim-qr.png', content: png, contentType: 'image/png' }]).catch(e => { S.log(`[eSIM] QR email ${d._id}: ${e.message}`); return false })
  await S.col.updateOne({ _id: d._id }, { $set: { qrEmailedAt: ok ? new Date() : null } })
  return ok
}
async function resendQr(chatId, id, email) {
  const d = await mine(chatId, id)
  if (!d || d.kind === 'mobile' || !['active', 'suspended'].includes(d.status)) return { error: 'This eSIM isn’t ready yet.' }
  const to = String(email || d.qrEmail || '').trim().toLowerCase()
  if (!EMAIL_RE.test(to)) return { error: 'Enter a valid email address.' }
  if (d.qrEmailedAt && Date.now() - new Date(d.qrEmailedAt).getTime() < 60000) return { error: 'We just sent it. Check your inbox and spam folder.' }
  if (!(await emailQr({ ...d, qrEmail: to }))) return { error: 'The email couldn’t be sent right now. Try again in a few minutes.' }
  await S.col.updateOne({ _id: d._id }, { $set: { qrEmail: to } })
  return { ok: true, email: to }
}

async function qr(chatId, id) {
  const d = await mine(chatId, id)
  if (!d || d.kind === 'mobile') return { error: 'Not found.' }
  if (d.qrCode && (d.simulated || !d.iccid)) return { qrCode: d.qrCode }
  if (!d.iccid) return { error: 'The eSIM is still being created.' }
  try { const r = await call('get', `/api/v1.1/esim/${encodeURIComponent(d.iccid)}/qr`); const q = typeof r?.data?.activationCode === 'string' ? r.data.activationCode : r?.data?.qrCode || null; if (q) await S.col.updateOne({ _id: d._id }, { $set: { qrCode: q } }); if (q) return { qrCode: q }; const u = r?.data?.qrCodeUrl; if (!u) return { qrCode: null }; const img = await axios.get(u, { responseType: 'arraybuffer', timeout: 15000 }); return { image: `data:${img.headers['content-type'] || 'image/png'};base64,${Buffer.from(img.data).toString('base64')}` } } catch (e) { return errOf(e) }
}
async function lineUsage(chatId, id) { const d = await mine(chatId, id); if (!d?.iccid) return { usage: null }; return d.simulated ? { usage: { simulated: true } } : usage(d.iccid) }

// Renewal. Spenza renews every line itself at its period end (expiresAt) and bills our Spenza balance; its API can only
// cancel at period end. So: the wallet is charged a day before expiry (retried until then); a line that is
// unpaid or has auto-renew off is cancelled with Spenza just before expiry, so we never pay for a month nobody paid for.
const DAY_MS = 86400000
const CUTOFF_MS = 60 * 60000
const period = (expiresAt) => ({ expiresAt, nextBillAt: new Date(expiresAt.getTime() - DAY_MS) })
async function subEnd(iccid, lineId) {
  const r = await call('get', `/api/v1.1/sims/${encodeURIComponent(iccid)}/subscription`).catch(() => null)
  const s = r?.data
  if (lineId && s) await S.col.updateOne({ _id: lineId }, { $set: { subscription: { status: s.status || null, startDate: s.startDate || null, endDate: s.endDate || null, autoTopUp: s.autoTopUp ?? null, product: s.productName || s.product || null, at: new Date() } } })
  const t = new Date(s?.endDate || 0)
  return t.getTime() > Date.now() ? t : null
}
const real = (d) => !dry() && !d.simulated && d.iccid && !d.linked
async function setService(d, on) {
  if (!real(d)) return
  await call('patch', `/api/v1.1/sims/${encodeURIComponent(d.iccid)}/service-state`, { voice: on, sms: on, data: on }).catch(e => S.log(`[Spenza] service-state ${d.iccid}: ${e.message}`))
}
const label = (d) => d.kind === 'mobile' ? `USA mobile number ${d.phoneNumber || ''}` : `eSIM ${d.phoneNumber || ''}`
const day = (t) => new Date(t).toISOString().slice(0, 10)
// Short email receipt after a wallet renewal (accounts with an email).
async function receipt(d, until) {
  const acc = await S.db.collection('webAccounts').findOne({ _id: { $in: [String(d.chatId), Number(d.chatId)] } }, { projection: { email: 1 } })
  const to = acc?.email || botEmailOf(d)
  const bal = round2(await S.w.balance(d.chatId)).toFixed(2), what = d.kind === 'mobile' ? 'USA mobile number' : 'USA eSIM'
  if (isBot(d.chatId)) await say(d.chatId, bt(d, 'receipt', d.phoneNumber, Number(d.price).toFixed(2), day(until), bal))
  if (!to) return false
  const row = (k, v) => `<tr><td style="padding:4px 16px 4px 0;color:#64748b">${k}</td><td style="padding:4px 0"><b>${v}</b></td></tr>`
  const html = `<p>Your ${what} renewed. Here’s your receipt.</p><table style="border-collapse:collapse;font-size:14px">${row('Line', `${what}${d.phoneNumber ? ` ${d.phoneNumber}` : ''}`)}${row('Paid', `$${Number(d.price).toFixed(2)} from your wallet`)}${row('Date', day(new Date()))}${row('Now active until', day(until))}${row('Wallet balance', `$${bal}`)}${row('Reference', d._id)}</table><p>Auto-renew stays on. You can turn it off any time ${d.source === 'telegram' ? 'in the Telegram bot under My eSIMs' : 'under Numbers → eSIM &amp; mobile numbers'}.</p>`
  const at = new Date()
  await S.col.updateOne({ _id: d._id }, { $push: { receipts: { $each: [{ at, amount: d.price, until, emailed: null }], $slice: -24 } } })
  const ok = await require('./cloudivr-web/auth').sendMail(to, `Receipt: your ${d.source === 'telegram' ? '' : 'CloudIVR '}${what} renewed`, html).catch(() => false)
  await S.col.updateOne({ _id: d._id }, { $set: { 'receipts.$[r].emailed': !!ok } }, { arrayFilters: [{ 'r.at': at }] })
  return ok
}
// Every payment and refund for one line (purchase, renewals, number replacement), newest first. Texts are left out.
const RECEIPT_KIND = { 'esim-purchase': 'Purchase', 'mobile-number-purchase': 'Purchase', 'esim-renewal': 'Renewal', 'esim-number-replace': 'Number replacement', 'esim-refund': 'Refund', 'mobile-number-refund': 'Refund', 'esim-number-refund': 'Refund' }
async function receiptsOf(chatId, id) {
  const d = await mine(chatId, id)
  if (!d) return { error: 'Line not found.' }
  const rows = await S.db.collection('transactions').find({ chatId: String(chatId), 'metadata.lineId': d._id, type: { $in: Object.keys(RECEIPT_KIND) } }).sort({ createdAt: -1 }).limit(100).toArray()
  return { receipts: rows.map(t => ({ id: String(t._id), kind: RECEIPT_KIND[t.type], refund: /refund/.test(t.type), amount: t.amount, at: t.createdAt, line: d.kind === 'mobile' ? 'USA mobile number' : 'USA eSIM', phoneNumber: d.phoneNumber || null, ...(t.metadata?.oldNumber ? { oldNumber: t.metadata.oldNumber } : {}) })) }
}
async function billOne(d) {
  if (!d.price || d.autoRenew === false) return false
  if (await S.w.debit(d.chatId, d.price)) {
    await txn(d.chatId, 'esim-renewal', d.price, { lineId: d._id })
    const base = (real(d) && await subEnd(d.iccid, d._id)) || new Date(d.expiresAt)
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'active', ...period(new Date(base.getTime() + MONTH_MS)), renewFailedAt: null, note: null, updatedAt: new Date() } })
    if (d.status === 'suspended') await setService(d, true)
    receipt(d, new Date(base.getTime() + MONTH_MS)).catch(e => S.log(`[Spenza] receipt ${d._id}: ${e.message}`))
    return true
  }
  if (d.status !== 'suspended') {
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'suspended', renewFailedAt: new Date(), note: `The $${d.price} renewal is due. Top up your wallet before ${day(d.expiresAt)} or the line ends then.`, updatedAt: new Date() } })
    await setService(d, false)
    say(d.chatId, bt(d, 'paused', d.phoneNumber, d.price, day(d.expiresAt)) || `⏸️ Your ${label(d)} is paused: the $${d.price} renewal couldn’t be paid from your wallet. Top up before ${day(d.expiresAt)} — we’ll retry automatically — or it ends on that date.`, { kind: 'billing', meta: { esim: d._id } })
  }
  return false
}
// Not renewed by the cut-off: cancel with Spenza (takes effect at its period end) and end the line here.
async function expire(d) {
  if (real(d)) {
    const ok = await call('post', `/api/v1.1/subscriptions/${encodeURIComponent(d.iccid)}/cancel`, {}).then(() => true).catch(e => { S.log(`[Spenza] expire ${d.iccid}: ${e.message}`); return /cancel/i.test(e.message) })
    if (!ok) return
  }
  const why = d.autoRenew === false ? 'auto-renew was off' : 'the renewal wasn’t paid'
  await S.col.updateOne({ _id: d._id }, { $set: { status: 'cancelled', note: `Ended on ${day(d.expiresAt)}: ${why}.`, updatedAt: new Date() } })
  if (d.kind === 'mobile' && d.phoneNumber) { await S.db.collection('webCallerIds').deleteOne({ _id: d.phoneNumber, method: 'auto' }); dropSip(d) }
  if (d.callsTo === 'browser') await syncSip()
  say(d.chatId, bt(d, 'ended', d.phoneNumber, day(d.expiresAt), d.autoRenew === false) || `📴 Your ${label(d)} ended on ${day(d.expiresAt)} because ${why}.`, { kind: 'billing', meta: { esim: d._id } })
}
// 3 days before expiry: app alert + email (or a text for phone-only accounts) with the date and wallet balance.
async function remind(d) {
  const end = day(d.expiresAt), bal = await S.w.balance(d.chatId)
  const renews = d.autoRenew !== false
  const text = renews
    ? `Your ${label(d)} renews on ${end}. $${d.price} will be taken from your wallet a day before. Wallet balance: $${round2(bal).toFixed(2)}.${bal < d.price ? ` Top up $${round2(d.price - bal).toFixed(2)} or more so it doesn’t end.` : ''}`
    : `Your ${label(d)} ends on ${end} because auto-renew is off. Turn auto-renew on before then to keep it. Wallet balance: $${round2(bal).toFixed(2)}.`
  const short = round2(Math.max(0, d.price - bal))
  const url = isBot(d.chatId) ? '' : require('./cloudivr-web/emails').appUrl(`/app/wallet?amount=${Math.max(5, Math.ceil(short))}`)
  const link = /^https?:\/\//.test(url) ? url : null
  await S.col.updateOne({ _id: d._id }, { $set: { remindedFor: new Date(d.expiresAt) } })
  say(d.chatId, (renews ? bt(d, 'renews', d.phoneNumber, end, d.price, round2(bal).toFixed(2), Math.ceil(short)) : bt(d, 'ends', d.phoneNumber, end, round2(bal).toFixed(2))) || `🔔 ${text}`, { kind: 'billing', meta: { ...(d.kind === 'mobile' ? { mobile: d._id } : { esim: d._id }), ...(renews && short > 0 ? { topup: Math.ceil(short) } : {}) } })
  const acc = await S.db.collection('webAccounts').findOne({ _id: { $in: [d.chatId, Number(d.chatId)] } }, { projection: { email: 1, phone: 1 } })
  const cta = renews && short > 0 && link && !isBot(d.chatId)
  const to = acc?.email || botEmailOf(d)
  if (to) await require('./cloudivr-web/auth').sendMail(to, renews ? `Your ${d.source === 'telegram' ? '' : 'CloudIVR '}line renews on ${end}` : `Your ${d.source === 'telegram' ? '' : 'CloudIVR '}line ends on ${end}`, `<p>${text}</p>${cta ? `<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Top up $${Math.ceil(short)} now</a></p>` : ''}<p>${d.source === 'telegram' ? 'Manage it in the Telegram bot: Digital Products → USA T-Mobile eSIM → My eSIMs.' : 'Manage it in CloudIVR under Numbers → eSIM &amp; mobile numbers.'}</p>`).catch(e => S.log(`[Spenza] reminder email ${d._id}: ${e.message}`))
  else if (acc?.phone) await require('./cloudivr-web/phone-auth').sendText(acc.phone, `CloudIVR: ${text}${cta ? ` Top up: ${link}` : ''}`).catch(e => S.log(`[Spenza] reminder text ${d._id}: ${e.message}`))
}
async function setAutoRenew(chatId, id, on) {
  const d = await mine(chatId, id)
  if (!d || !['active', 'suspended', 'provisioning'].includes(d.status)) return { error: 'Only active lines have auto-renew.' }
  if (d.expiresAt && new Date(d.expiresAt).getTime() - CUTOFF_MS <= Date.now()) return { error: 'This line is about to end and can’t be changed now.' }
  await S.col.updateOne({ _id: d._id }, { $set: { autoRenew: !!on, updatedAt: new Date() } })
  return { item: pub({ ...d, autoRenew: !!on }) }
}
async function renew(chatId, id) {
  const d = await mine(chatId, id); if (!d || d.status !== 'suspended') return { error: 'Nothing to renew.' }
  if (!(await billOne({ ...d, autoRenew: true }))) return { error: `Your wallet needs $${d.price}. Top up first.`, code: 'insufficient_balance' }
  await S.col.updateOne({ _id: d._id }, { $set: { autoRenew: true } })
  return { item: pub(await mine(chatId, id)) }
}
async function cancel(chatId, id) {
  const d = await mine(chatId, id)
  if (!d || !['active', 'suspended'].includes(d.status)) return { error: d?.kind === 'mobile' ? 'This number can be cancelled once it’s assigned.' : 'Only active eSIMs can be cancelled.' }
  if (!dry() && !d.simulated && d.iccid && !d.linked) await call('post', `/api/v1.1/subscriptions/${encodeURIComponent(d.iccid)}/cancel`, {}).catch(e => S.log(`[Spenza] cancel ${d.iccid}: ${e.message}`))
  await S.col.updateOne({ _id: d._id }, { $set: { status: 'cancelled', updatedAt: new Date() } })
  if (d.callsTo === 'browser') await syncSip()
  if (d.kind === 'mobile' && d.phoneNumber) { await S.db.collection('webCallerIds').deleteOne({ _id: d.phoneNumber, method: 'auto' }); dropSip(d) }
  return { ok: true }
}

// ---------- replace the line's number ($25): the carrier assigns a new one (no choice of number or area) ----------
const REPLACE_PRICE = 25
async function replaceNumber(chatId, id) {
  const d = await mine(chatId, id)
  if (!d || d.status !== 'active' || !d.phoneNumber || !d.iccid) return { error: 'Only active eSIMs with a number can get a new number.' }
  if (d.numberChange?.status === 'pending') return { error: 'A new number is already on its way for this eSIM.' }
  if (!(await S.w.debit(chatId, REPLACE_PRICE))) return { error: `A new number costs $${REPLACE_PRICE}. Top up your wallet first.`, code: 'insufficient_balance' }
  await txn(chatId, 'esim-number-replace', REPLACE_PRICE, { lineId: d._id, oldNumber: d.phoneNumber })
  if (!dry() && !d.simulated) {
    try { await call('post', `/api/v1.1/sims/${encodeURIComponent(d.iccid)}/renew-number`, {}) } catch (e) {
      await S.w.credit(chatId, REPLACE_PRICE); await txn(chatId, 'esim-number-refund', REPLACE_PRICE, { lineId: d._id })
      S.log(`[eSIM] renew-number ${d._id}: ${e.status || ''} ${e.code || ''} ${e.message}`)
      const quota = e.status === 429 || /quota|limit/i.test(e.message)
      return { error: `${quota ? 'The carrier’s limit for new numbers is reached for now.' : 'The carrier won’t give this eSIM a new number right now.'} Your $${REPLACE_PRICE} was refunded.`, code: 'replace_refused' }
    }
  }
  const numberChange = { status: 'pending', at: new Date(), oldNumber: d.phoneNumber, paid: REPLACE_PRICE }
  await S.col.updateOne({ _id: d._id }, { $set: { numberChange, updatedAt: new Date() } })
  say(chatId, `🔁 New number requested for your eSIM ${d.phoneNumber} ($${REPLACE_PRICE}). We’ll let you know as soon as it’s assigned.`, { kind: 'billing', meta: { esim: d._id } })
  return { item: pub({ ...d, numberChange }) }
}
async function pollNumber(d) {
  const nc = d.numberChange
  let fresh = null
  if (d.simulated || dry()) { if (Date.now() - new Date(nc.at).getTime() > 20000) fresh = '+1555' + String(Date.now()).slice(-7) }
  else { const sim = unwrap(await call('get', '/api/v1.1/sims?page=1&pageSize=100')).find(s => s.iccid === d.iccid); if (sim?.phoneNumber && sim.phoneNumber !== nc.oldNumber) fresh = sim.phoneNumber }
  if (fresh) {
    await S.col.updateOne({ _id: d._id }, { $set: { phoneNumber: fresh, 'numberChange.status': 'done', 'numberChange.newNumber': fresh, 'numberChange.doneAt': new Date(), updatedAt: new Date() }, $push: { formerNumbers: { phone: nc.oldNumber, until: new Date() } } })
    if (d.callsTo === 'browser') await syncSip()
    if (d.kind === 'mobile') CID().autoVerify(S.db, d.chatId, fresh).catch(e => S.log(`[mobile] caller ID ${d._id}: ${e.message}`))
    say(d.chatId, `📱 Your eSIM has its new number: ${fresh} (was ${nc.oldNumber}). Texts and calls now use the new number.`, { kind: 'billing', meta: { esim: d._id, replaced: { old: nc.oldNumber, new: fresh } } })
  } else if (Date.now() - new Date(nc.at).getTime() > 86400000) {
    await S.w.credit(d.chatId, nc.paid || REPLACE_PRICE); await txn(d.chatId, 'esim-number-refund', nc.paid || REPLACE_PRICE, { lineId: d._id })
    await S.col.updateOne({ _id: d._id }, { $set: { 'numberChange.status': 'refunded', updatedAt: new Date() } })
    say(d.chatId, `⚠️ The carrier didn’t assign a new number to your eSIM ${nc.oldNumber} within 24 hours. $${nc.paid || REPLACE_PRICE} was refunded; support has been told.`, { kind: 'billing', meta: { esim: d._id } })
    S.log(`[eSIM] ALERT number change for ${d._id} not assigned in 24 h — refunded`)
  }
}

// ---------- texting ----------
async function sendSms(chatId, id, to, text) {
  const d = await mine(chatId, id)
  if (d && d.kind !== 'mobile') return { error: 'Texts from a QR eSIM are sent from your phone, not from CloudIVR.' }
  if (!d || d.status !== 'active' || !d.phoneNumber) return { error: 'This number can’t send texts right now.' }
  const dest = String(to || '').replace(/[^\d+]/g, ''), body = require('./cloudivr-web/sms-limit').gsmText(String(text || '').trim())
  const long = require('./cloudivr-web/sms-limit').smsTooLong(body)
  if (long) return { error: long }
  if (!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(dest)) return { error: 'Texts can go to USA numbers: enter +1 and the 10-digit number.' }
  if (!body) return { error: 'Type a message.' }
  const parts = require('./cloudivr-web/sms-limit').smsParts(body), cost = round2(TEXT_PRICE * parts)
  if (!(await S.w.debit(chatId, cost))) return { error: `Your wallet needs $${cost.toFixed(2)} to send this text${parts > 1 ? ` (${parts} parts)` : ''}.` }
  if (!d.simulated) {
    try { await call('post', '/api/v1.1/sms', { fromNumber: d.phoneNumber, toNumber: dest, text: body }) } catch (e) { await S.w.credit(chatId, cost); S.log(`[eSIM] sms ${d._id}: ${e.message}`); return { error: e.code === 'FORBIDDEN' || e.status === 401 || e.status === 403 ? 'Texts from this eSIM aren’t switched on yet. We’ve let support know. You weren’t charged.' : 'The text couldn’t be sent. You weren’t charged. Try again in a minute.' } }
  }
  await txn(chatId, 'esim-sms', cost, { lineId: d._id, to: dest, parts })
  const log = { chatId: String(chatId), phoneNumber: d.phoneNumber, from: d.phoneNumber, to: dest, type: 'sms', direction: 'outbound', body, esim: d._id, charge: cost, status: d.simulated ? 'preview' : 'sent', timestamp: new Date() }
  await S.db.collection('phoneLogs').insertOne(log)
  return { log }
}
async function messages(chatId, id) { const d = await mine(chatId, id); if (!d?.phoneNumber) return []; return S.db.collection('phoneLogs').find({ chatId: String(chatId), esim: d._id }).sort({ timestamp: -1 }).limit(100).toArray() }

// Inbound webhook (payload schema not published yet — accept the common field names).
function verify(raw, sig, ts, secret) {
  if (!secret || !sig || !ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const exp = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')
  const got = String(sig).split(',').find(p => p.startsWith('v1='))?.slice(3) || ''
  return got.length === exp.length && crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(got))
}
async function onWebhook(raw, headers, body) {
  const cfg = await S.db.collection('spenzaConfig').findOne({ _id: 'webhook' })
  if (!cfg?.signingSecret) { S.log('[eSIM] webhook rejected: no signing secret saved — reconnect incoming texts in Admin → eSIM'); return { status: 401 } }
  if (!verify(raw, headers['x-spenza-signature'], headers['x-spenza-timestamp'], cfg.signingSecret)) { S.log('[eSIM] webhook rejected: bad signature'); return { status: 401 } }
  const b = body?.data || body || {}
  if ((b.eventType || body?.eventType) === 'webhook.test') { S.log('[Spenza] webhook test received'); return { status: 200 } }
  const norm = (n) => { const x = String(n || '').replace(/[^\d+]/g, ''); return x.startsWith('+') ? x : x.length === 10 ? '+1' + x : x ? '+' + x : '' }
  const first = (v) => (Array.isArray(v) ? v[0] : v)
  const from = norm(b.From || b.from || b.fromNumber || b.source), to = norm(b.Owner || first(b.To) || b.to || b.toNumber || b.mdn), text = String(b.Message_Body || b.text || b.message || b.body || '').slice(0, 2000)
  const mid = b.Message_ID || null
  if (String(b.Direction || 'inbound').toLowerCase() !== 'inbound') return { status: 200 }
  const d = to && await S.col.findOne({ phoneNumber: to, status: { $in: ['active', 'suspended'] } })
  if (!d || !text) { S.log(`[eSIM] webhook unmatched (${body?.event || '?'})`); return { status: 200 } }
  if (d.kind !== 'mobile') return { status: 200 }
  const cid = await CID().autoCode(S.db, d.phoneNumber, text).catch(() => null)
  if (cid === 'verified') { await say(d.chatId, `✅ ${d.phoneNumber} is now one of your caller IDs, free. Pick it as “Show as” on calls and campaigns.`, { kind: 'system', meta: { mobile: d._id } }); return { status: 200 } }
  if (cid) return { status: 200 }
  const dup = await S.db.collection('phoneLogs').findOne(mid ? { esim: d._id, providerId: mid } : { esim: d._id, from, body: text, direction: 'inbound', timestamp: { $gt: new Date(Date.now() - 10 * 60000) } })
  if (dup) return { status: 200 }
  await S.db.collection('phoneLogs').insertOne({ chatId: d.chatId, phoneNumber: d.phoneNumber, from, to: d.phoneNumber, type: 'sms', direction: 'inbound', body: text, esim: d._id, providerId: mid, charge: 0, timestamp: new Date() })
  await say(d.chatId, `💬 Text to your ${d.kind === 'mobile' ? 'mobile number' : 'eSIM'} ${d.phoneNumber} from ${from}: ${text}`, { kind: 'sms', meta: { from, to: d.phoneNumber, esim: d._id } })
  return { status: 200 }
}
async function registerWebhook(baseUrl) {
  if (!baseUrl) return { error: 'SELF_URL isn’t set, so Spenza has nowhere to send texts.' }
  const url = `${baseUrl.replace(/\/$/, '')}/api/cloudivr-web/public/spenza/webhook`
  if (dry()) return { ok: true, url, preview: true }
  try {
    const r = await call('post', '/api/v1.1/webhooks', { operator: 'SpenzaJ', network: 'SpenzaJ', eventType: 'both', webhookUrls: { messageUrl: url, voiceUrl: url }, authentication: { type: 'none' }, update: true })
    await S.db.collection('spenzaConfig').updateOne({ _id: 'webhook' }, { $set: { url, at: new Date(), id: r?.data?.id || null, signingSecret: r?.data?.signingSecret } }, { upsert: true })
    return { ok: true, url }
  } catch (e) { return errOf(e) }
}

// ---------- calls: ring the phone (default) or CloudIVR (browser / IVR) via Spenza's SIP gateway ----------
async function syncSip() {
  const nums = (await S.col.find({ callsTo: 'browser', status: 'active', phoneNumber: { $ne: null } }).toArray()).map(d => d.phoneNumber)
  const ip = process.env.SPENZA_SIP_INGRESS_IP
  const pending = !ip || dry()
  if (!pending) {
    try { await call('post', '/api/v1/customer/register-sip', { sipIngressIp: ip, sipPort: Number(process.env.SPENZA_SIP_PORT || 5060), transport: 'udp', didRanges: nums, isSIPEnabled: nums.length > 0 }) } catch (e) { S.log(`[Spenza] SIP sync: ${e.message}`); return { error: e.message } }
  }
  await S.db.collection('spenzaConfig').updateOne({ _id: 'sip' }, { $set: { numbers: nums, ip: ip || null, pending, at: new Date() } }, { upsert: true })
  return { ok: true, pending }
}
async function setCallsTo(chatId, id, to, ivrNumber) {
  const d = await mine(chatId, id)
  if (!d || d.kind === 'mobile' || d.status !== 'active') return { error: 'Only active eSIMs can change where calls ring.' }
  const v = to === 'browser' ? 'browser' : 'device'
  let menu = d.ivrNumber || null
  if (v === 'browser') {
    const nums = ((await S.db.collection('phoneNumbersOf').findOne({ _id: chatId }))?.val?.numbers || []).filter(n => n.status === 'active')
    menu = nums.find(n => n.phoneNumber === ivrNumber)?.phoneNumber || null
    if (!menu) return { error: nums.length ? 'Pick which VoIP number’s menu these calls should use.' : 'You need an active VoIP number: its keypad menu, forwarding and voicemail answer these calls.' }
  }
  await S.col.updateOne({ _id: d._id }, { $set: { callsTo: v, ivrNumber: menu, updatedAt: new Date() } })
  const r = await syncSip()
  return { item: pub({ ...d, callsTo: v, ivrNumber: menu }), pending: !!r.pending }
}

// One-off: lines the owner asked to hand to an existing account (runs until the account exists).
const PRELINK = [{ phone: '+16462556424', email: 'onarrival21@gmail.com', kind: 'mobile' }]
async function prelink() {
  for (const p of PRELINK) {
    const done = await S.db.collection('spenzaConfig').findOne({ _id: 'prelink:' + p.phone })
    if (done) continue
    const acct = await S.db.collection('webAccounts').findOne({ email: p.email }, { projection: { _id: 1 } })
    if (!acct || !process.env.SPENZA_API_KEY) continue
    const sim = unwrap(await call('get', '/api/v1.1/sims?page=1&pageSize=100')).find(s => s.phoneNumber === p.phone)
    if (!sim) continue
    const r = await linkSim(sim.iccid, p.email, p.kind)
    if (r.ok) { await S.db.collection('spenzaConfig').insertOne({ _id: 'prelink:' + p.phone, at: new Date() }); S.log(`[eSIM] linked ${p.phone} to ${p.email}`) }
  }
}

// One-off owner decision: the linked 646 line is a web-only USA mobile number (texts in Messages, no QR), not a QR eSIM.
async function toMobile() {
  for (const p of PRELINK.filter(x => x.kind === 'mobile')) {
    const flag = 'mobile:' + p.phone
    if (await S.db.collection('spenzaConfig').findOne({ _id: flag })) continue
    const d = await S.col.findOne({ phoneNumber: p.phone, linked: true, status: { $in: ['active', 'suspended'] } })
    if (!d) continue
    if (d.callsTo === 'browser') await S.col.updateOne({ _id: d._id }, { $set: { callsTo: 'device' } })
    await S.col.updateOne({ _id: d._id }, { $set: { kind: 'mobile', callsTo: 'device', ivrNumber: null, updatedAt: new Date() } })
    await S.db.collection('spenzaConfig').insertOne({ _id: flag, at: new Date() })
    S.log(`[mobile] ${p.phone} is now a web-only mobile number`)
    if (d.callsTo === 'browser') await syncSip()
    await CID().autoVerify(S.db, d.chatId, p.phone).catch(e => S.log(`[mobile] caller ID ${p.phone}: ${e.message}`))
  }
}

// One-off owner decision: USA Starter eSIM sells at $75.
async function defaultPrice() {
  const flag = 'price:SPENZA_001:75'
  if (await S.db.collection('spenzaConfig').findOne({ _id: flag })) return
  await S.db.collection('esimPlans').updateOne({ _id: 'SPENZA_001' }, { $set: { price: 75, enabled: true, updatedAt: new Date() }, $setOnInsert: { label: 'USA Starter eSIM' } }, { upsert: true })
  await S.db.collection('spenzaConfig').insertOne({ _id: flag, at: new Date() })
}

async function tick() {
  for (const d of await S.col.find({ status: 'provisioning' }).limit(50).toArray()) await pollOne(d).catch(e => S.log(`[Spenza] poll ${d._id}: ${e.message}`))
  const live = { status: { $in: ['active', 'suspended'] }, price: { $gt: 0 } }
  // Lines from before expiry tracking: their old bill date was the period end.
  for (const d of await S.col.find({ ...live, expiresAt: null }).limit(50).toArray()) await S.col.updateOne({ _id: d._id }, { $set: period((real(d) && await subEnd(d.iccid)) || new Date(Math.max(new Date(d.nextBillAt || 0).getTime(), Date.now() + 2 * DAY_MS))) })
  for (const d of await S.col.find({ ...live, expiresAt: { $lte: new Date(Date.now() + CUTOFF_MS) } }).limit(50).toArray()) await expire(d).catch(e => S.log(`[Spenza] expire ${d._id}: ${e.message}`))
  for (const d of await S.col.find({ ...live, autoRenew: { $ne: false }, nextBillAt: { $lte: new Date() }, expiresAt: { $gt: new Date(Date.now() + CUTOFF_MS) } }).limit(50).toArray()) await billOne(d).catch(e => S.log(`[Spenza] bill ${d._id}: ${e.message}`))
  for (const d of await S.col.find({ ...live, expiresAt: { $gt: new Date(Date.now() + CUTOFF_MS), $lte: new Date(Date.now() + 3 * DAY_MS) }, $expr: { $ne: ['$remindedFor', '$expiresAt'] } }).limit(50).toArray()) await remind(d).catch(e => S.log(`[Spenza] remind ${d._id}: ${e.message}`))
  // Every paid line (new and older ones) sits under its owner's Spenza user.
  for (const d of await S.col.find({ status: { $in: ['active', 'suspended'] }, iccid: { $ne: null }, linked: { $ne: true }, 'spenzaUser.linkedAt': null, userLinkFailedAt: { $not: { $gt: new Date(Date.now() - 3600000) } } }).limit(20).toArray()) {
    await linkUser(d).catch(async e => { S.log(`[Spenza] link user ${d._id}: ${e.message}`); await S.col.updateOne({ _id: d._id }, { $set: { userLinkFailedAt: new Date() } }) })
  }
  for (const d of await S.col.find({ 'numberChange.status': 'pending' }).limit(20).toArray()) await pollNumber(d).catch(e => S.log(`[Spenza] number change ${d._id}: ${e.message}`))
  await imeiChase().catch(e => S.log(`[eSIM] IMEI chase: ${e.message}`))
}

// The Telegram bot instance: bot buyers get notices and the QR code in their chat.
function setBot(bot, notice) { if (S && bot) Object.assign(S, { bot, notice }) }
function init({ db, log = console.log, tell }) {
  if (S) return api
  S = { db, col: db.collection('esimLines'), w: walletOps(db), log, tell }
  S.col.createIndex({ chatId: 1, status: 1 }).catch(() => {})
  S.col.createIndex({ phoneNumber: 1 }).catch(() => {})
  setInterval(() => tick().catch(() => {}), 15000).unref?.()
  const pl2 = () => prelink().then(toMobile).catch(e => log(`[eSIM] prelink: ${e.message}`))
  pl2(); setInterval(pl2, 10 * 60000).unref?.()
  defaultPrice().catch(e => log(`[eSIM] default price: ${e.message}`))
  return api
}

const api = { init, setBot, sendBotQr, tick, syncUser, linkUser, receiptsOf, MOBILE_PRICE, mobileOffer, buyMobile, mobileSip, resendQr, emailQr, replaceNumber, REPLACE_PRICE, setAutoRenew, catalog, setPlan, forSale, plansForCustomers, fleet, usage, linkSim, list, buy, submitImei, imeiChase, qr, lineUsage, renew, cancel, sendSms, messages, onWebhook, registerWebhook, setCallsTo, syncSip, TEXT_PRICE }
module.exports = api
