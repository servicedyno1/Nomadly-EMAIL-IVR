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
const custPlan = (p) => ({ planId: p.planId, label: p.label || null, price: p.price, validityDays: p.validityDays, data: p.data, voiceMinutes: p.voiceMinutes, sms: p.sms, carrier: 'US network' })

const planOut = (p, cfg) => ({
  planId: p.productId, cost: p.price, currency: p.currency, validityDays: p.validityDays, recurring: !!p.recurring,
  data: p.data ? `${p.data.value} ${p.data.unit}` : null, voiceMinutes: p.voiceMinutes ?? null,
  sms: p.smsCount == null ? null : p.smsCount >= 999999 ? 'Unlimited' : p.smsCount,
  operator: p.operator, network: p.network, isEsim: !!p.isEsim, planType: p.planType,
  price: cfg?.price ?? null, enabled: !!cfg?.enabled, label: cfg?.label || null,
})

// ---------- catalog (admin sets price + enabled per plan) ----------
async function catalog() {
  const [plans, cfgs] = await Promise.all([call('get', '/api/v1.1/plans?page=1&pageSize=100'), S.db.collection('esimPlans').find().toArray()])
  const by = Object.fromEntries(cfgs.map(c => [c._id, c]))
  return unwrap(plans).map(p => planOut(p, by[p.productId]))
}
async function setPlan(planId, { price, enabled, label }) {
  const p = Number(price)
  if (enabled && !(p > 0)) return { error: 'Set a customer price above $0 before turning this plan on.' }
  await S.db.collection('esimPlans').updateOne({ _id: String(planId) }, { $set: { price: p > 0 ? round2(p) : null, enabled: !!enabled, label: label ? String(label).slice(0, 60) : null, updatedAt: new Date() } }, { upsert: true })
  return { ok: true }
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
async function linkSim(iccid, email) {
  const acct = await S.db.collection('webAccounts').findOne({ email: String(email || '').trim().toLowerCase() }, { projection: { _id: 1 } })
  if (!acct) return { error: 'No CloudIVR account with that email.' }
  const sim = unwrap(await call('get', '/api/v1.1/sims?page=1&pageSize=100')).find(s => s.iccid === iccid)
  if (!sim) return { error: 'That SIM isn’t on your Spenza account.' }
  const sub = await call('get', `/api/v1.1/sims/${encodeURIComponent(iccid)}/subscription`).catch(() => null)
  const _id = 'es_' + crypto.randomBytes(6).toString('hex')
  await S.col.updateOne({ iccid }, { $set: { chatId: String(acct._id), iccid, phoneNumber: sim.phoneNumber || null, isEsim: !!sim.isEsim, planId: sub?.data?.productId || sub?.data?.planId || null, status: 'active', price: 0, linked: true, updatedAt: new Date() }, $setOnInsert: { _id, callsTo: 'device', createdAt: new Date() } }, { upsert: true })
  return { ok: true }
}

// ---------- customer lines ----------
const pub = (d) => ({ id: d._id, iccid: d.iccid || null, phoneNumber: d.phoneNumber || null, planId: d.planId, price: d.price, status: d.status, note: d.note || null, callsTo: d.callsTo || 'device', nextBillAt: d.nextBillAt || null, createdAt: d.createdAt, linked: !!d.linked, hasQr: !!(d.qrCode || d.iccid) })
const luhn = (s) => { let sum = 0; for (let i = 0; i < s.length; i++) { let n = +s[s.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9 } sum += n } return sum % 10 === 0 }
const txn = (chatId, type, amount, meta) => S.db.collection('transactions').insertOne({ chatId: String(chatId), type, amount: round2(amount), currency: 'USD', status: 'completed', metadata: { ...meta, channel: 'esim' }, createdAt: new Date(), updatedAt: new Date() })

async function list(chatId) { return (await S.col.find({ chatId: String(chatId), status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).toArray()).map(pub) }
async function mine(chatId, id) { return S.col.findOne({ _id: String(id), chatId: String(chatId) }) }

async function buy(chatId, { planId, imei, simId }) {
  const im = String(imei || '').replace(/\D/g, '')
  if (im.length !== 15 || !luhn(im)) return { error: 'Enter your phone’s 15-digit IMEI (dial *#06# to see it).' }
  const plan = (await forSale()).find(p => p.planId === planId)
  if (!plan) return { error: 'That plan isn’t available.' }
  if (!(await S.w.debit(chatId, plan.price))) return { error: `Your wallet needs $${plan.price} for this eSIM. Top up first.`, code: 'insufficient_balance' }
  const _id = 'es_' + crypto.randomBytes(6).toString('hex')
  const doc = { _id, chatId: String(chatId), planId, price: plan.price, imei: im, status: 'provisioning', callsTo: 'device', createdAt: new Date(), updatedAt: new Date() }
  await S.col.insertOne(doc)
  await txn(chatId, 'esim-purchase', plan.price, { planId, lineId: _id })
  if (dry()) { await S.col.updateOne({ _id }, { $set: { transactionId: 'preview-' + _id, simulated: true } }); return { item: pub(doc) } }
  try {
    const r = await call('post', '/api/v1.1/esim', { imei: im, simId: simId || process.env.SPENZA_ESIM_SIM_ID || undefined, planId, activateNow: true }, { 'Idempotency-Key': _id })
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

// Poll provisioning; a finished one gets its number, ICCID and QR.
async function pollOne(d) {
  if (d.simulated) {
    if (Date.now() - new Date(d.createdAt).getTime() < 20000) return
    const iccid = '8901' + String(Date.now()).slice(-15)
    return S.col.updateOne({ _id: d._id }, { $set: { status: 'active', iccid, phoneNumber: '+1555' + String(Date.now()).slice(-7), qrCode: `LPA:1$preview.spenza.test$${d._id}`, nextBillAt: new Date(Date.now() + MONTH_MS), updatedAt: new Date() } })
  }
  const r = await axios.get(`${API}/api/v3/transactions/${encodeURIComponent(d.transactionId)}`, { timeout: 15000 }).then(x => x.data?.data).catch(() => null)
  const st = String(r?.status || '').toLowerCase()
  if (['completed', 'succeeded', 'success'].includes(st)) {
    const x = r.result || {}
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'active', iccid: x.iccid || null, phoneNumber: x.mdn ? (String(x.mdn).startsWith('+') ? x.mdn : '+1' + String(x.mdn).replace(/\D/g, '').slice(-10)) : null, qrCode: x.qrCode || null, orderId: x.orderId || null, nextBillAt: new Date(Date.now() + MONTH_MS), updatedAt: new Date() } })
    S.tell(d.chatId, '📱 Your eSIM is ready. Open CloudIVR eSIM and scan the QR code with your phone to install it.', { kind: 'billing', meta: { esim: d._id } })
  } else if (['failed', 'error'].includes(st)) {
    await S.w.credit(d.chatId, d.price); await txn(d.chatId, 'esim-refund', d.price, { lineId: d._id })
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'failed', note: 'The eSIM couldn’t be created. Your payment was refunded.', providerError: r?.error?.message || null, updatedAt: new Date() } })
    S.tell(d.chatId, `⚠️ Your eSIM couldn’t be created. $${d.price} was refunded to your wallet.`, { kind: 'billing', meta: { esim: d._id } })
  }
}

async function qr(chatId, id) {
  const d = await mine(chatId, id)
  if (!d) return { error: 'Not found.' }
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
async function renew(chatId, id) { const d = await mine(chatId, id); if (!d || d.status !== 'suspended') return { error: 'Nothing to renew.' }; return (await billOne(d)) ? { item: pub({ ...d, status: 'active' }) } : { error: `Your wallet needs $${d.price}. Top up first.` } }
async function cancel(chatId, id) {
  const d = await mine(chatId, id)
  if (!d || !['active', 'suspended'].includes(d.status)) return { error: 'Only active eSIMs can be cancelled.' }
  if (!dry() && !d.simulated && d.iccid && !d.linked) await call('post', `/api/v1.1/subscriptions/${encodeURIComponent(d.iccid)}/cancel`, {}).catch(e => S.log(`[Spenza] cancel ${d.iccid}: ${e.message}`))
  await S.col.updateOne({ _id: d._id }, { $set: { status: 'cancelled', updatedAt: new Date() } })
  if (d.callsTo === 'browser') await syncSip()
  return { ok: true }
}

// ---------- texting ----------
async function sendSms(chatId, id, to, text) {
  const d = await mine(chatId, id)
  if (!d || d.status !== 'active' || !d.phoneNumber) return { error: 'This eSIM can’t send texts right now.' }
  const dest = String(to || '').replace(/[^\d+]/g, ''), body = String(text || '').trim().slice(0, 1000)
  if (!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(dest)) return { error: 'Texts can go to US numbers: enter +1 and the 10-digit number.' }
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
  const dup = await S.db.collection('phoneLogs').findOne(mid ? { esim: d._id, providerId: mid } : { esim: d._id, from, body: text, direction: 'inbound', timestamp: { $gt: new Date(Date.now() - 10 * 60000) } })
  if (dup) return { status: 200 }
  await S.db.collection('phoneLogs').insertOne({ chatId: d.chatId, phoneNumber: d.phoneNumber, from, to: d.phoneNumber, type: 'sms', direction: 'inbound', body: text, esim: d._id, providerId: mid, charge: 0, timestamp: new Date() })
  await S.tell(d.chatId, `💬 Text to your eSIM ${d.phoneNumber} from ${from}: ${text}`, { kind: 'sms', meta: { from, to: d.phoneNumber, esim: d._id } })
  return { status: 200 }
}
async function registerWebhook(baseUrl) {
  if (!baseUrl) return { error: 'SELF_URL isn’t set, so Spenza has nowhere to send texts.' }
  const url = `${baseUrl.replace(/\/$/, '')}/api/cloudivr-web/public/spenza/webhook`
  if (dry()) return { ok: true, url, preview: true }
  try {
    const r = await call('post', '/api/v1.1/webhooks', { operator: 'SpenzaJ', network: 'SpenzaJ', eventType: 'both', webhookUrls: { messageUrl: url, voiceUrl: url }, authentication: { type: 'none' } })
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
    try { await call('post', '/api/v1/customer/register-sip', { sipIngressIp: ip, sipPort: Number(process.env.SPENZA_SIP_PORT || 5060), transport: 'UDP', didRanges: nums, isSIPEnabled: nums.length > 0 }) } catch (e) { S.log(`[Spenza] SIP sync: ${e.message}`); return { error: e.message } }
  }
  await S.db.collection('spenzaConfig').updateOne({ _id: 'sip' }, { $set: { numbers: nums, ip: ip || null, pending, at: new Date() } }, { upsert: true })
  return { ok: true, pending }
}
async function setCallsTo(chatId, id, to) {
  const d = await mine(chatId, id)
  if (!d || d.status !== 'active') return { error: 'Only active eSIMs can change where calls ring.' }
  const v = to === 'browser' ? 'browser' : 'device'
  await S.col.updateOne({ _id: d._id }, { $set: { callsTo: v, updatedAt: new Date() } })
  const r = await syncSip()
  return { item: pub({ ...d, callsTo: v }), pending: !!r.pending }
}

// One-off: lines the owner asked to hand to an existing account (runs until the account exists).
const PRELINK = [{ phone: '+16462556424', email: 'onarrival21@gmail.com' }]
async function prelink() {
  for (const p of PRELINK) {
    const done = await S.db.collection('spenzaConfig').findOne({ _id: 'prelink:' + p.phone })
    if (done) continue
    const acct = await S.db.collection('webAccounts').findOne({ email: p.email }, { projection: { _id: 1 } })
    if (!acct || !process.env.SPENZA_API_KEY) continue
    const sim = unwrap(await call('get', '/api/v1.1/sims?page=1&pageSize=100')).find(s => s.phoneNumber === p.phone)
    if (!sim) continue
    const r = await linkSim(sim.iccid, p.email)
    if (r.ok) { await S.db.collection('spenzaConfig').insertOne({ _id: 'prelink:' + p.phone, at: new Date() }); S.log(`[eSIM] linked ${p.phone} to ${p.email}`) }
  }
}

async function tick() {
  for (const d of await S.col.find({ status: 'provisioning' }).limit(50).toArray()) await pollOne(d).catch(e => S.log(`[Spenza] poll ${d._id}: ${e.message}`))
  for (const d of await S.col.find({ status: { $in: ['active', 'suspended'] }, nextBillAt: { $lte: new Date() } }).limit(50).toArray()) await billOne(d).catch(e => S.log(`[Spenza] bill ${d._id}: ${e.message}`))
}

function init({ db, log = console.log, tell }) {
  if (S) return api
  S = { db, col: db.collection('esimLines'), w: walletOps(db), log, tell }
  S.col.createIndex({ chatId: 1, status: 1 }).catch(() => {})
  S.col.createIndex({ phoneNumber: 1 }).catch(() => {})
  setInterval(() => tick().catch(() => {}), 15000).unref?.()
  const pl = () => prelink().catch(e => log(`[eSIM] prelink: ${e.message}`))
  pl(); setInterval(pl, 10 * 60000).unref?.()
  return api
}

const api = { init, catalog, setPlan, forSale, plansForCustomers, fleet, usage, linkSim, list, buy, qr, lineUsage, renew, cancel, sendSms, messages, onWebhook, registerWebhook, setCallsTo, syncSip, TEXT_PRICE }
module.exports = api
