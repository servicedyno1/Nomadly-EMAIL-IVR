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
const unwrap = (r) => (Array.isArray(r?.data) ? r.data : r?.data?.items || r?.data || [])
const FRIENDLY = 'The eSIM service didn’t respond. Try again in a minute.'
const errOf = (e) => { S?.log(`[eSIM] provider: ${e.message}`); return { error: FRIENDLY } }
const custPlan = (p) => ({ planId: p.planId, label: p.label || null, price: p.price, validityDays: p.validityDays, data: p.data, voiceMinutes: p.voiceMinutes, sms: p.sms, carrier: 'T-Mobile network' })

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
const pub = (d) => ({ numberChange: d.numberChange ? { status: d.numberChange.status, at: d.numberChange.at, oldNumber: d.numberChange.oldNumber, newNumber: d.numberChange.newNumber || null } : null, formerNumbers: (d.formerNumbers || []).map(f => f.phone), autoRenew: d.autoRenew !== false, id: d._id, iccid: d.iccid || null, phoneNumber: d.phoneNumber || null, planId: d.planId, price: d.price, status: d.status, note: d.note || null, callsTo: d.callsTo || 'device', ivrNumber: d.ivrNumber || null, nextBillAt: d.nextBillAt || null, createdAt: d.createdAt, linked: !!d.linked, kind: d.kind || 'esim', zipcode: d.zipcode || null, hasQr: d.kind !== 'mobile' && !!(d.qrCode || d.iccid), qrEmail: d.qrEmail || null, qrEmailedAt: d.qrEmailedAt || null })
const luhn = (s) => { let sum = 0; for (let i = 0; i < s.length; i++) { let n = +s[s.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9 } sum += n } return sum % 10 === 0 }
const txn = (chatId, type, amount, meta) => S.db.collection('transactions').insertOne({ chatId: String(chatId), type, amount: round2(amount), currency: 'USD', status: 'completed', metadata: { ...meta, channel: 'esim' }, createdAt: new Date(), updatedAt: new Date() })

async function list(chatId, kind = 'esim') { return (await S.col.find({ chatId: String(chatId), status: { $ne: 'cancelled' }, kind: kind === 'mobile' ? 'mobile' : { $ne: 'mobile' } }).sort({ createdAt: -1 }).toArray()).map(pub) }
async function mine(chatId, id) { return S.col.findOne({ _id: String(id), chatId: String(chatId) }) }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
async function buy(chatId, { planId, imei, zipcode, email }) {
  const qrEmail = String(email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(qrEmail)) return { error: 'Enter the email address where we should send your eSIM QR code.' }
  const im = String(imei || '').replace(/\D/g, '')
  if (im.length !== 15 || !luhn(im)) return { error: 'Enter your phone’s 15-digit IMEI (dial *#06# to see it).' }
  const zip = String(zipcode || '').trim()
  if (zip && !/^\d{5}$/.test(zip)) return { error: 'Enter a 5-digit USA ZIP code, or leave it empty.' }
  const plan = (await forSale()).find(p => p.planId === planId)
  if (!plan) return { error: 'That plan isn’t available.' }
  if (!plan.simId) return { error: 'eSIMs are temporarily unavailable. Try again later.' }
  if (!(await S.w.debit(chatId, plan.price))) return { error: `Your wallet needs $${plan.price} for this eSIM. Top up first.`, code: 'insufficient_balance' }
  const _id = 'es_' + crypto.randomBytes(6).toString('hex')
  const doc = { _id, chatId: String(chatId), planId, price: plan.price, imei: im, zipcode: zip || null, simId: plan.simId, qrEmail, status: 'provisioning', callsTo: 'device', createdAt: new Date(), updatedAt: new Date() }
  await S.col.insertOne(doc)
  await txn(chatId, 'esim-purchase', plan.price, { planId, lineId: _id })
  if (dry()) { await S.col.updateOne({ _id }, { $set: { transactionId: 'preview-' + _id, simulated: true } }); return { item: pub(doc) } }
  try {
    const r = await call('post', '/api/v1.1/esim', { imei: im, simId: plan.simId, planId, activateNow: true, ...(zip ? { zipcode: zip } : {}) }, { 'Idempotency-Key': _id })
    await S.col.updateOne({ _id }, { $set: { transactionId: r?.data?.transactionId || r?.transactionId } })
    return { item: pub(doc) }
  } catch (e) {
    await S.w.credit(chatId, plan.price); await txn(chatId, 'esim-refund', plan.price, { lineId: _id })
    S.log(`[eSIM] create ${_id}: ${e.message}`)
    await S.col.updateOne({ _id }, { $set: { status: 'failed', note: 'The eSIM couldn’t be created. Your payment was refunded.', providerError: e.message, updatedAt: new Date() } })
    S.tell(chatId, `⚠️ Your eSIM couldn’t be created. $${plan.price} was refunded to your wallet.`, { kind: 'billing', meta: { esim: _id } })
    return { error: `We couldn’t create the eSIM right now. Your $${plan.price} was refunded to your wallet.`, code: 'esim_failed' }
  }
}

// ---------- USA mobile number for texting ($75/month): an eSIM line held by CloudIVR, number shown once assigned ----------
const MOBILE_PRICE = 75
const mobileImei = () => (dry() ? '356938035643809' : String(process.env.SPENZA_TEXT_LINE_IMEI || '').replace(/\D/g, ''))
async function mobileOffer() {
  const plan = (await forSale().catch(() => [])).find(p => p.simId)
  return { available: !!plan && mobileImei().length === 15, price: MOBILE_PRICE }
}
async function buyMobile(chatId, { zipcode }) {
  const zip = String(zipcode || '').trim()
  if (!/^\d{5}$/.test(zip)) return { error: 'Enter a 5-digit USA ZIP code so we can ask for a number near it.' }
  const im = mobileImei()
  const plan = (await forSale()).find(p => p.simId)
  if (!plan || im.length !== 15) return { error: 'USA mobile numbers are temporarily unavailable. Try again later.' }
  if (!(await S.w.debit(chatId, MOBILE_PRICE))) return { error: `Your wallet needs $${MOBILE_PRICE} for this number. Top up first.`, code: 'insufficient_balance' }
  const _id = 'mn_' + crypto.randomBytes(6).toString('hex')
  const doc = { _id, kind: 'mobile', chatId: String(chatId), planId: plan.planId, price: MOBILE_PRICE, imei: im, zipcode: zip, simId: plan.simId, status: 'provisioning', callsTo: 'device', createdAt: new Date(), updatedAt: new Date() }
  await S.col.insertOne(doc)
  await txn(chatId, 'mobile-number-purchase', MOBILE_PRICE, { lineId: _id, zipcode: zip })
  if (dry()) { await S.col.updateOne({ _id }, { $set: { transactionId: 'preview-' + _id, simulated: true } }); return { item: pub(doc) } }
  try {
    const r = await call('post', '/api/v1.1/esim', { imei: im, simId: plan.simId, planId: plan.planId, activateNow: true, zipcode: zip }, { 'Idempotency-Key': _id })
    await S.col.updateOne({ _id }, { $set: { transactionId: r?.data?.transactionId || r?.transactionId } })
    return { item: pub(doc) }
  } catch (e) {
    await S.w.credit(chatId, MOBILE_PRICE); await txn(chatId, 'mobile-number-refund', MOBILE_PRICE, { lineId: _id })
    S.log(`[mobile] create ${_id}: ${e.message}`)
    await S.col.updateOne({ _id }, { $set: { status: 'failed', note: 'The number couldn’t be set up. Your payment was refunded.', providerError: e.message, updatedAt: new Date() } })
    return { error: `We couldn’t set up the number right now. Your $${MOBILE_PRICE} was refunded to your wallet.`, code: 'mobile_failed' }
  }
}
const CID = () => require('./cloudivr-web/caller-ids')
async function ready(d, phone) {
  if (d.kind !== 'mobile') return
  await S.tell(d.chatId, `📱 Your USA mobile number is ready: ${phone || ''}. Texts to and from it are in Messages.`, { kind: 'billing', meta: { mobile: d._id } })
  if (!phone) return
  const r = await CID().autoVerify(S.db, d.chatId, phone).catch(e => { S.log(`[mobile] caller ID ${d._id}: ${e.message}`); return null })
  if (r === 'verified') await S.tell(d.chatId, `✅ ${phone} is now one of your caller IDs, free. Pick it as “Show as” on calls and campaigns.`, { kind: 'system', meta: { mobile: d._id } })
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
    if (Date.now() - new Date(d.createdAt).getTime() < 20000) return
    const iccid = '8901' + String(Date.now()).slice(-15)
    const phone = '+1555' + String(Date.now()).slice(-7)
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'active', iccid, phoneNumber: phone, qrCode: `LPA:1$preview.spenza.test$${d._id}`, nextBillAt: new Date(Date.now() + MONTH_MS), updatedAt: new Date() } })
    return d.kind === 'mobile' ? ready(d, phone) : emailQr({ ...d, phoneNumber: phone })
  }
  const r = await axios.get(`${API}/api/v3/transactions/${encodeURIComponent(d.transactionId)}`, { timeout: 15000 }).then(x => x.data?.data).catch(() => null)
  const st = String(r?.status || '').toLowerCase()
  if (['completed', 'succeeded', 'success'].includes(st)) {
    const x = r.result || {}
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'active', iccid: x.iccid || null, phoneNumber: x.mdn ? (String(x.mdn).startsWith('+') ? x.mdn : '+1' + String(x.mdn).replace(/\D/g, '').slice(-10)) : null, qrCode: x.qrCode || null, orderId: x.orderId || null, nextBillAt: new Date(Date.now() + MONTH_MS), updatedAt: new Date() } })
    if (d.kind === 'mobile') return ready(d, x.mdn ? '+1' + String(x.mdn).replace(/\D/g, '').slice(-10) : null)
    const sent = await emailQr({ ...d, phoneNumber: x.mdn || null })
    S.tell(d.chatId, `📱 Your eSIM is ready. Open CloudIVR eSIM and scan the QR code with your phone to install it.${sent ? ` We also emailed it to ${d.qrEmail}.` : ''}`, { kind: 'billing', meta: { esim: d._id } })
  } else if (['failed', 'error'].includes(st) || Date.now() - new Date(d.createdAt).getTime() > 86400000) {
    await S.w.credit(d.chatId, d.price); await txn(d.chatId, 'esim-refund', d.price, { lineId: d._id })
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'failed', note: 'The eSIM couldn’t be created. Your payment was refunded.', providerError: r?.error?.message || (st ? null : 'timed out after 24 h'), updatedAt: new Date() } })
    S.tell(d.chatId, d.kind === 'mobile' ? `⚠️ Your USA mobile number couldn’t be set up. $${d.price} was refunded to your wallet.` : `⚠️ Your eSIM couldn’t be created. $${d.price} was refunded to your wallet.`, { kind: 'billing', meta: d.kind === 'mobile' ? { mobile: d._id } : { esim: d._id } })
  }
}

// The QR code goes only to the app and to the email given at checkout.
async function emailQr(d) {
  if (!d.qrEmail) return false
  const got = await qr(d.chatId, d._id).catch(() => ({}))
  const code = got?.qrCode || null
  if (!code && !got?.image) return false
  const png = code ? await require('qrcode').toBuffer(code, { width: 360, margin: 2 }) : Buffer.from(got.image.split(',')[1], 'base64')
  const html = `<p>Your CloudIVR eSIM${d.phoneNumber ? ` for <b>${d.phoneNumber}</b>` : ''} is ready.</p><p>On the phone that will use it: Settings → Mobile / Cellular → Add eSIM → Use QR code, then scan the attached QR code. Keep the phone on Wi-Fi while it installs. Each QR code can be installed once.</p>${code ? `<p>Manual code: <code>${code}</code></p>` : ''}<p>You can also open the QR code any time in the CloudIVR app under CloudIVR eSIM.</p>`
  const ok = await require('./cloudivr-web/auth').sendMail(d.qrEmail, 'Your CloudIVR eSIM QR code', html, [{ filename: 'cloudivr-esim-qr.png', content: png, contentType: 'image/png' }]).catch(e => { S.log(`[eSIM] QR email ${d._id}: ${e.message}`); return false })
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

// Monthly renewal from the wallet; unpaid → voice/SMS/data off until paid.
async function setService(d, on) {
  if (dry() || d.simulated || !d.iccid) return
  await call('patch', `/api/v1.1/sims/${encodeURIComponent(d.iccid)}/service-state`, { voice: on, sms: on, data: on }).catch(e => S.log(`[Spenza] service-state ${d.iccid}: ${e.message}`))
}
async function billOne(d) {
  if (d.autoRenew === false) return expire(d)
  if (!d.price) return S.col.updateOne({ _id: d._id }, { $set: { nextBillAt: new Date(Date.now() + MONTH_MS) } })
  if (await S.w.debit(d.chatId, d.price)) {
    await txn(d.chatId, 'esim-renewal', d.price, { lineId: d._id })
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'active', nextBillAt: new Date(Date.now() + MONTH_MS), note: null, updatedAt: new Date() } })
    if (d.status === 'suspended') await setService(d, true)
    return true
  }
  if (d.status !== 'suspended') {
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'suspended', note: `The $${d.price} monthly fee is due. Top up your wallet and tap Renew.`, updatedAt: new Date() } })
    await setService(d, false)
    S.tell(d.chatId, `⏸️ Your eSIM ${d.phoneNumber || ''} is paused: the $${d.price} monthly fee couldn’t be paid. Top up your wallet and tap Renew.`, { kind: 'billing', meta: { esim: d._id } })
  }
  return false
}
// Auto-renew off: at the end of the paid month the line stops and its plan is cancelled with the carrier.
async function expire(d) {
  if (!dry() && !d.simulated && d.iccid && !d.linked) await call('post', `/api/v1.1/subscriptions/${encodeURIComponent(d.iccid)}/cancel`, {}).catch(e => S.log(`[Spenza] expire ${d.iccid}: ${e.message}`))
  await S.col.updateOne({ _id: d._id }, { $set: { status: 'cancelled', note: 'Ended: auto-renew was off.', updatedAt: new Date() } })
  if (d.kind === 'mobile' && d.phoneNumber) await S.db.collection('webCallerIds').deleteOne({ _id: d.phoneNumber, method: 'auto' })
  if (d.callsTo === 'browser') await syncSip()
  S.tell(d.chatId, `📴 Your eSIM ${d.phoneNumber || ''} ended at the end of its paid month because auto-renew was off.`, { kind: 'billing', meta: { esim: d._id } })
}
async function setAutoRenew(chatId, id, on) {
  const d = await mine(chatId, id)
  if (!d || !['active', 'suspended', 'provisioning'].includes(d.status)) return { error: 'Only active eSIMs have auto-renew.' }
  await S.col.updateOne({ _id: d._id }, { $set: { autoRenew: !!on, updatedAt: new Date() } })
  return { item: pub({ ...d, autoRenew: !!on }) }
}
async function renew(chatId, id) {
  const d = await mine(chatId, id); if (!d || d.status !== 'suspended') return { error: 'Nothing to renew.' }
  if (!(await billOne({ ...d, autoRenew: true }))) return { error: `Your wallet needs $${d.price}. Top up first.`, code: 'insufficient_balance' }
  await S.col.updateOne({ _id: d._id }, { $set: { autoRenew: true } })
  return { item: pub({ ...d, status: 'active', autoRenew: true }) }
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
  S.tell(chatId, `🔁 New number requested for your eSIM ${d.phoneNumber} ($${REPLACE_PRICE}). We’ll let you know as soon as it’s assigned.`, { kind: 'billing', meta: { esim: d._id } })
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
    S.tell(d.chatId, `📱 Your eSIM has its new number: ${fresh} (was ${nc.oldNumber}). Texts and calls now use the new number.`, { kind: 'billing', meta: { esim: d._id, replaced: { old: nc.oldNumber, new: fresh } } })
  } else if (Date.now() - new Date(nc.at).getTime() > 86400000) {
    await S.w.credit(d.chatId, nc.paid || REPLACE_PRICE); await txn(d.chatId, 'esim-number-refund', nc.paid || REPLACE_PRICE, { lineId: d._id })
    await S.col.updateOne({ _id: d._id }, { $set: { 'numberChange.status': 'refunded', updatedAt: new Date() } })
    S.tell(d.chatId, `⚠️ The carrier didn’t assign a new number to your eSIM ${nc.oldNumber} within 24 hours. $${nc.paid || REPLACE_PRICE} was refunded; support has been told.`, { kind: 'billing', meta: { esim: d._id } })
    S.log(`[eSIM] ALERT number change for ${d._id} not assigned in 24 h — refunded`)
  }
}

// ---------- texting ----------
async function sendSms(chatId, id, to, text) {
  const d = await mine(chatId, id)
  if (d && d.kind !== 'mobile') return { error: 'Texts from a QR eSIM are sent from your phone, not from CloudIVR.' }
  if (!d || d.status !== 'active' || !d.phoneNumber) return { error: 'This number can’t send texts right now.' }
  const dest = String(to || '').replace(/[^\d+]/g, ''), body = String(text || '').trim().slice(0, 1000)
  if (!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(dest)) return { error: 'Texts can go to USA numbers: enter +1 and the 10-digit number.' }
  if (!body) return { error: 'Type a message.' }
  if (!(await S.w.debit(chatId, TEXT_PRICE))) return { error: `Your wallet needs $${TEXT_PRICE} to send a text.` }
  if (!d.simulated) {
    try { await call('post', '/api/v1.1/sms', { fromNumber: d.phoneNumber, toNumber: dest, text: body }) } catch (e) { await S.w.credit(chatId, TEXT_PRICE); S.log(`[eSIM] sms ${d._id}: ${e.message}`); return { error: e.code === 'FORBIDDEN' || e.status === 401 || e.status === 403 ? 'Texts from this eSIM aren’t switched on yet. We’ve let support know. You weren’t charged.' : 'The text couldn’t be sent. You weren’t charged. Try again in a minute.' } }
  }
  await txn(chatId, 'esim-sms', TEXT_PRICE, { lineId: d._id, to: dest })
  const log = { chatId: String(chatId), phoneNumber: d.phoneNumber, from: d.phoneNumber, to: dest, type: 'sms', direction: 'outbound', body, esim: d._id, charge: TEXT_PRICE, status: d.simulated ? 'preview' : 'sent', timestamp: new Date() }
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
  if (cid === 'verified') { await S.tell(d.chatId, `✅ ${d.phoneNumber} is now one of your caller IDs, free. Pick it as “Show as” on calls and campaigns.`, { kind: 'system', meta: { mobile: d._id } }); return { status: 200 } }
  if (cid) return { status: 200 }
  const dup = await S.db.collection('phoneLogs').findOne(mid ? { esim: d._id, providerId: mid } : { esim: d._id, from, body: text, direction: 'inbound', timestamp: { $gt: new Date(Date.now() - 10 * 60000) } })
  if (dup) return { status: 200 }
  await S.db.collection('phoneLogs').insertOne({ chatId: d.chatId, phoneNumber: d.phoneNumber, from, to: d.phoneNumber, type: 'sms', direction: 'inbound', body: text, esim: d._id, providerId: mid, charge: 0, timestamp: new Date() })
  await S.tell(d.chatId, `💬 Text to your ${d.kind === 'mobile' ? 'mobile number' : 'eSIM'} ${d.phoneNumber} from ${from}: ${text}`, { kind: 'sms', meta: { from, to: d.phoneNumber, esim: d._id } })
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
    if (!menu) return { error: nums.length ? 'Pick which calling number’s menu these calls should use.' : 'You need an active calling number: its keypad menu, forwarding and voicemail answer these calls.' }
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
  for (const d of await S.col.find({ status: { $in: ['active', 'suspended'] }, nextBillAt: { $lte: new Date() } }).limit(50).toArray()) await billOne(d).catch(e => S.log(`[Spenza] bill ${d._id}: ${e.message}`))
  for (const d of await S.col.find({ 'numberChange.status': 'pending' }).limit(20).toArray()) await pollNumber(d).catch(e => S.log(`[Spenza] number change ${d._id}: ${e.message}`))
}

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

const api = { init, MOBILE_PRICE, mobileOffer, buyMobile, mobileSip, resendQr, emailQr, replaceNumber, REPLACE_PRICE, setAutoRenew, catalog, setPlan, forSale, plansForCustomers, fleet, usage, linkSim, list, buy, qr, lineUsage, renew, cancel, sendSms, messages, onWebhook, registerWebhook, setCallsTo, syncSip, TEXT_PRICE }
module.exports = api
