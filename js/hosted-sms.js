'use strict'
// Hosted SMS ("Text-enable your number"): a customer keeps their number + calls with their carrier, texting moves to
// Telnyx. One-time setup ($300 with the ownership code, $500 without) + $50/month, all from the USD wallet.
// Flow: eligibility → pay → (code) → details + bill PDF → we generate and e-sign the LOA → Telnyx review → active.
// Rejected → full refund. Unpaid month → paused (texts not delivered/sent) until the wallet covers it.
const axios = require('axios')
const crypto = require('crypto')
const FormData = require('form-data')
const { walletOps, round2 } = require('./cloudivr-web/wallet')

const PRICE = { code: 300, nocode: 500 }
const MONTHLY = 50
const TEXT_PRICE = 0.05
const MONTH_MS = 30 * 86400000
const MAX_TEXT = 160
const E164 = /^\+[1-9]\d{7,14}$/
const API = 'https://api.telnyx.com/v2'
const FIX_DOCS = ['loa_file_invalid', 'incorrect_billing_information', 'incomplete_documentation']
const REJECTED = ['carrier_rejected', 'compliance_review_failed', 'failed', 'ineligible_carrier', 'deleted']
const REASON = {
  loa_file_invalid: 'The authorization letter was not accepted.',
  incorrect_billing_information: 'The name or address doesn’t match the phone bill.',
  incomplete_documentation: 'Telnyx needs a clearer or more recent phone bill.',
  carrier_rejected: 'The number’s current carrier refused texting on another network.',
  ineligible_carrier: 'This number’s carrier doesn’t support texting through another provider.',
  compliance_review_failed: 'The number didn’t pass the compliance review.',
  failed: 'Telnyx couldn’t complete the setup.',
  deleted: 'The setup was cancelled.',
}
const dry = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const hdr = () => ({ Authorization: `Bearer ${process.env.TELNYX_API_KEY}` })
const normPhone = (p) => { const d = String(p || '').replace(/[^\d+]/g, ''); return d.startsWith('+') ? d : d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : `+${d}` }
const errText = (e) => { const x = e.response?.data?.errors?.[0]; return x ? `${x.title || ''} ${x.detail || ''}`.trim() : e.message }

let S = null // { db, col, w, log, tell, brand }

function init({ db, log = console.log, tell, brand }) {
  if (S) return api
  const col = db.collection('hostedSms')
  col.createIndex({ chatId: 1 }).catch(() => {})
  col.createIndex({ phoneNumber: 1, status: 1 }).catch(() => {})
  col.createIndex({ phoneNumber: 1 }, { unique: true, partialFilterExpression: { live: true }, name: 'one_live_per_number' }).catch(() => {})
  db.collection('hostedSmsThreads').createIndex({ at: 1 }, { expireAfterSeconds: 30 * 86400 }).catch(() => {})
  S = { db, col, w: walletOps(db), log, tell, brand }
  col.updateMany({ status: { $in: ['verify', 'documents', 'review', 'active', 'paused'] }, live: { $exists: false } }, { $set: { live: true } }).catch(() => {})
  const t = setInterval(() => tick().catch(e => log(`[HostedSMS] tick: ${e.message}`)), dry() ? 30000 : 10 * 60000)
  t.unref?.()
  setTimeout(() => tick().catch(() => {}), 15000).unref?.()
  return api
}

const txn = (chatId, type, amount, meta) => S.db.collection('transactions').insertOne({ chatId: String(chatId), type, amount: round2(amount), currency: 'USD', status: 'completed', metadata: { ...meta, channel: 'hosted-sms' }, createdAt: new Date(), updatedAt: new Date() })
const pub = (d) => ({
  id: d._id, phoneNumber: d.phoneNumber, mode: d.mode, status: d.status, note: d.note || null, paid: d.paid, monthly: MONTHLY,
  nextBillAt: d.nextBillAt || null, createdAt: d.createdAt, activatedAt: d.activatedAt || null, holder: d.holder || null,
})
const mine = (chatId, id) => S.col.findOne({ _id: String(id), chatId: String(chatId) })
const list = async (chatId) => (await S.col.find({ chatId: String(chatId), status: { $nin: ['cancelled', 'starting'] } }).sort({ createdAt: -1 }).toArray()).map(pub)

async function check(phone) {
  const p = normPhone(phone)
  if (!E164.test(p)) return { eligible: false, phoneNumber: p, detail: 'Enter the full number with country code, e.g. +1 312 555 0100.' }
  if (await S.col.findOne({ phoneNumber: p, status: { $in: ['starting', 'verify', 'documents', 'review', 'active', 'paused'] } })) return { eligible: false, phoneNumber: p, detail: 'This number is already being text-enabled.' }
  if (dry()) return { eligible: p.startsWith('+1'), phoneNumber: p, detail: p.startsWith('+1') ? 'Eligible (preview)' : 'Only US and Canada numbers can be text-enabled.' }
  try {
    const r = await axios.post(`${API}/messaging_hosted_number_orders/eligibility_numbers_check`, { phone_numbers: [p] }, { headers: hdr(), timeout: 20000 })
    const n = (r.data?.phone_numbers || r.data?.data?.phone_numbers || [])[0] || {}
    return { eligible: !!n.eligible, phoneNumber: p, detail: n.detail || n.eligible_status || '' }
  } catch (e) { return { eligible: false, phoneNumber: p, detail: `Couldn’t check right now: ${errText(e)}` } }
}

// Pays the setup and opens the Telnyx order.
async function start(chatId, phone, mode) {
  if (!require('./cloudivr-web/notify.js').isWebChatId(chatId)) return { error: 'Landline to Texting is available on cloudivr.net.' }
  if (!PRICE[mode]) return { error: 'Choose with or without the ownership code.' }
  const el = await check(phone)
  if (!el.eligible) return { error: el.detail || 'This number can’t be text-enabled.' }
  const price = PRICE[mode]
  const _id = `hs_${crypto.randomBytes(6).toString('hex')}`
  // Claim the number first (unique while live) so two clicks can't pay twice.
  try { await S.col.insertOne({ _id, chatId: String(chatId), phoneNumber: el.phoneNumber, mode, status: 'starting', live: true, paid: 0, createdAt: new Date(), updatedAt: new Date() }) } catch (e) { if (e.code === 11000) return { error: 'This number is already being text-enabled.' }; throw e }
  if (!(await S.w.debit(chatId, price))) { await S.col.deleteOne({ _id }); return { error: `Your wallet needs $${price} for this setup. Top up first.`, code: 'insufficient_balance' } }
  let orderId = `preview-${_id}`
  if (!dry()) {
    try {
      const r = await axios.post(`${API}/messaging_hosted_number_orders`, { phone_numbers: [el.phoneNumber], ...(process.env.TELNYX_MESSAGING_PROFILE_ID ? { messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID } : {}) }, { headers: hdr(), timeout: 20000 })
      orderId = r.data?.data?.id
    } catch (e) {
      await S.w.credit(chatId, price)
      await S.col.deleteOne({ _id })
      S.log(`[HostedSMS] order failed for ${el.phoneNumber}: ${errText(e)}`)
      return { error: `Telnyx couldn’t open the order: ${errText(e)}. You weren’t charged.` }
    }
  }
  const doc = { _id, chatId: String(chatId), phoneNumber: el.phoneNumber, mode, status: mode === 'code' ? 'verify' : 'documents', live: true, telnyxOrderId: orderId, paid: price, createdAt: new Date(), updatedAt: new Date() }
  await S.col.updateOne({ _id }, { $set: { status: doc.status, telnyxOrderId: orderId, paid: price, updatedAt: new Date() } })
  await txn(chatId, 'hosted-sms-setup', price, { phoneNumber: el.phoneNumber, mode, hostedId: _id })
  S.log(`[HostedSMS] ${chatId} started ${el.phoneNumber} (${mode}, $${price})`)
  return { item: pub(doc) }
}

async function sendCode(chatId, id, method = 'sms') {
  const d = await mine(chatId, id)
  if (!d || d.status !== 'verify') return { error: 'Nothing to verify for this number.' }
  if (dry()) return { ok: true, method, preview: 'Preview: use code 123456' }
  try {
    await axios.post(`${API}/messaging_hosted_number_orders/${d.telnyxOrderId}/verification_codes`, { phone_numbers: [d.phoneNumber], verification_method: method === 'call' ? 'call' : 'sms' }, { headers: hdr(), timeout: 20000 })
    return { ok: true, method }
  } catch (e) { return { error: `Couldn’t send the code: ${errText(e)}` } }
}

async function submitCode(chatId, id, code) {
  const d = await mine(chatId, id)
  if (!d || d.status !== 'verify') return { error: 'Nothing to verify for this number.' }
  const c = String(code || '').replace(/\D/g, '')
  if (!c) return { error: 'Enter the code you received.' }
  let ok = dry() ? c === '123456' : false
  if (!dry()) {
    try {
      const r = await axios.post(`${API}/messaging_hosted_number_orders/${d.telnyxOrderId}/validation_codes`, { verification_codes: [{ phone_number: d.phoneNumber, code: c }] }, { headers: hdr(), timeout: 20000 })
      const n = (r.data?.data?.phone_numbers || [])[0]
      ok = !n || n.status === 'verified'
    } catch (e) { return { error: `That code didn’t work: ${errText(e)}` } }
  }
  if (!ok) return { error: 'That code didn’t work. Check it or send a new one.' }
  await S.col.updateOne({ _id: d._id }, { $set: { status: 'documents', verifiedAt: new Date(), updatedAt: new Date() } })
  return { item: pub({ ...d, status: 'documents' }) }
}

const HOLDER_FIELDS = ['name', 'business', 'address', 'city', 'state', 'zip', 'carrier', 'account']
function cleanHolder(h = {}) {
  const o = {}
  for (const k of HOLDER_FIELDS) o[k] = String(h[k] || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const miss = ['name', 'address', 'city', 'state', 'zip', 'carrier'].filter(k => !o[k])
  if (miss.length) return { error: `Fill in: ${miss.join(', ')}.` }
  const bad = HOLDER_FIELDS.filter(k => /[^\x20-\x7E\u00A0-\u00FF’‘“”–—]/.test(o[k]))
  return bad.length ? { error: `Type ${bad.join(', ')} in Latin letters exactly as on your US/Canada phone bill.` } : { holder: o }
}

// LOA filled from the customer's details and e-signed with their typed name (they tick a consent box first).
async function buildLoa(d, holder, { ip }) {
  const latin = (v) => String(v || '').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?')
  holder = Object.fromEntries(Object.entries(holder).map(([k, v]) => [k, latin(v)]))
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const sig = await pdf.embedFont(StandardFonts.TimesRomanBoldItalic)
  const ink = rgb(0.06, 0.09, 0.16)
  let y = 740
  const line = (text, { f = font, size = 11, gap = 16, x = 56 } = {}) => { page.drawText(String(text), { x, y, size, font: f, color: ink, maxWidth: 500 }); y -= gap }
  const today = new Date().toISOString().slice(0, 10)
  line('LETTER OF AUTHORIZATION — HOSTED SMS / MMS', { f: bold, size: 15, gap: 26 })
  line(`Date: ${today}`, { gap: 22 })
  line('Customer of record (as shown on the phone bill):', { f: bold })
  line(`Authorized person: ${holder.name}`)
  if (holder.business) line(`Business name: ${holder.business}`)
  line(`Service address: ${holder.address}, ${holder.city}, ${holder.state} ${holder.zip}`)
  line(`Current voice provider: ${holder.carrier}`)
  if (holder.account) line(`Account number: ${holder.account}`)
  y -= 8
  line('Telephone number(s) to be hosted for messaging:', { f: bold })
  line(d.phoneNumber, { gap: 24 })
  const body = [
    'I, the undersigned, am the account holder or am authorized to act on behalf of the account holder for the',
    'telephone number(s) listed above. I authorize Telnyx LLC and its agents to enable and route SMS and MMS',
    'messaging for these number(s) on the Telnyx network. Voice service remains with my current provider and is',
    'not transferred. I understand that messaging previously provided by another provider may stop for these',
    'number(s), and that this authorization remains in effect until revoked in writing.',
  ]
  for (const b of body) line(b, { size: 10, gap: 14 })
  y -= 22
  line('Signature:', { f: bold, gap: 6 })
  page.drawText(holder.name, { x: 56, y: y - 22, size: 24, font: sig, color: rgb(0.1, 0.15, 0.45) })
  y -= 34
  page.drawLine({ start: { x: 56, y }, end: { x: 330, y }, thickness: 0.8, color: ink })
  y -= 16
  line(`Printed name: ${holder.name}    Date: ${today}`, { size: 10 })
  y -= 10
  line(`Electronically signed by ${holder.name} on ${new Date().toISOString()} from IP ${ip || 'n/a'}`, { size: 8, gap: 11 })
  line(`via ${S.brand?.() || 'CloudIVR'} — order ${d._id}. The signer confirmed the details and consented to an electronic signature.`, { size: 8, gap: 11 })
  pdf.setTitle(`LOA ${d.phoneNumber}`)
  return Buffer.from(await pdf.save())
}

async function submitDocs(chatId, id, { holder: rawHolder, bill, consent, ip }) {
  const d = await mine(chatId, id)
  if (!d || d.status !== 'documents') return { error: 'This number isn’t waiting for documents.' }
  if (!consent) return { error: 'Tick the box to let us sign the authorization letter for you.' }
  const { holder, error } = cleanHolder(rawHolder)
  if (error) return { error }
  if (!Buffer.isBuffer(bill) || bill.slice(0, 5).toString() !== '%PDF-') return { error: 'Upload your phone bill as a PDF.' }
  if (bill.length > 5 * 1024 * 1024) return { error: 'The bill PDF must be under 5 MB.' }
  const loa = await buildLoa(d, holder, { ip })
  if (!dry()) {
    try {
      const form = new FormData()
      form.append('loa', loa, { filename: `loa-${d._id}.pdf`, contentType: 'application/pdf' })
      form.append('bill', bill, { filename: `bill-${d._id}.pdf`, contentType: 'application/pdf' })
      await axios.post(`${API}/messaging_hosted_number_orders/${d.telnyxOrderId}/actions/file_upload`, form, { headers: { ...hdr(), ...form.getHeaders() }, timeout: 60000, maxBodyLength: 20 * 1024 * 1024 })
    } catch (e) { return { error: `Telnyx didn’t accept the documents: ${errText(e)}` } }
  }
  await S.col.updateOne({ _id: d._id }, { $set: { status: 'review', holder, note: null, docsAt: new Date(), signedIp: ip || null, updatedAt: new Date() } })
  S.log(`[HostedSMS] documents sent for ${d.phoneNumber} (${d._id})`)
  return { item: pub({ ...d, status: 'review', holder }) }
}

async function cancel(chatId, id) {
  const d = await mine(chatId, id)
  if (!d || !['verify', 'documents'].includes(d.status)) return { error: 'Only setups that haven’t been sent for review can be cancelled.' }
  return { item: pub(await reject(d, null, 'cancelled')) }
}

async function reject(d, note, status = 'rejected') {
  const r = await S.col.findOneAndUpdate({ _id: d._id, status: { $in: ['verify', 'documents', 'review'] } }, { $set: { status, note, refunded: d.paid, updatedAt: new Date() }, $unset: { live: '' } }, { returnDocument: 'after' })
  const doc = r?.value || r
  if (!doc || doc.status !== status) return d
  await S.w.credit(d.chatId, d.paid)
  await txn(d.chatId, 'hosted-sms-refund', d.paid, { phoneNumber: d.phoneNumber, hostedId: d._id })
  if (!dry() && d.telnyxOrderId) axios.delete(`${API}/messaging_hosted_number_orders/${d.telnyxOrderId}`, { headers: hdr(), timeout: 20000 }).catch(() => {})
  S.tell(d.chatId, status === 'cancelled' ? `↩️ Landline to Texting setup for ${d.phoneNumber} cancelled — $${d.paid} refunded to your wallet.` : `❌ Texting for ${d.phoneNumber} couldn’t be set up. ${note} $${d.paid} was refunded to your wallet.`, { kind: 'billing', meta: { hosted: d._id } })
  return doc
}

async function pollOne(d) {
  let st = null
  if (dry()) st = Date.now() - new Date(d.docsAt || d.updatedAt).getTime() > 60000 ? 'successful' : 'pending'
  else {
    try { st = (await axios.get(`${API}/messaging_hosted_number_orders/${d.telnyxOrderId}`, { headers: hdr(), timeout: 20000 })).data?.data?.status } catch (e) { return }
  }
  if (st === 'successful') {
    const r = await S.col.updateOne({ _id: d._id, status: 'review' }, { $set: { status: 'active', note: null, activatedAt: new Date(), nextBillAt: new Date(Date.now() + MONTH_MS), updatedAt: new Date() } })
    if (r.modifiedCount) S.tell(d.chatId, `✅ ${d.phoneNumber} can now send and receive texts. Incoming texts land in your Inbox — reply right there. $${MONTHLY}/month from your wallet, next on ${new Date(Date.now() + MONTH_MS).toISOString().slice(0, 10)}.`, { kind: 'billing', meta: { hosted: d._id } })
  } else if (FIX_DOCS.includes(st) && d.status === 'review') {
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'documents', note: REASON[st], updatedAt: new Date() } })
    S.tell(d.chatId, `⚠️ ${d.phoneNumber}: ${REASON[st]} Please send the details and phone bill again — no extra charge.`, { kind: 'billing', meta: { hosted: d._id } })
  } else if (REJECTED.includes(st)) {
    await reject(d, REASON[st] || 'Telnyx rejected the request.')
  }
}

async function billOne(d) {
  if (d.status === 'paused' && !(d.retryAt && new Date(d.retryAt) <= new Date())) return
  const r = await S.col.updateOne({ _id: d._id, nextBillAt: d.nextBillAt, status: d.status }, { $set: { billingAt: new Date() } })
  if (!r.modifiedCount) return
  if (await S.w.debit(d.chatId, MONTHLY)) {
    const next = new Date(Math.max(Date.now(), new Date(d.nextBillAt).getTime()) + MONTH_MS)
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'active', nextBillAt: next, retryAt: null, updatedAt: new Date() } })
    await txn(d.chatId, 'hosted-sms-renewal', MONTHLY, { phoneNumber: d.phoneNumber, hostedId: d._id })
    if (d.status === 'paused') S.tell(d.chatId, `✅ Texting on ${d.phoneNumber} is back on — $${MONTHLY} paid from your wallet.`, { kind: 'billing', meta: { hosted: d._id } })
  } else {
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'paused', retryAt: new Date(Date.now() + 86400000), updatedAt: new Date() } })
    if (d.status !== 'paused') S.tell(d.chatId, `⏸ Texting on ${d.phoneNumber} is paused: the $${MONTHLY} monthly fee couldn’t be paid from your wallet. Top up and it turns back on within a day.`, { kind: 'billing', meta: { hosted: d._id } })
  }
}

async function tick() {
  for (const d of await S.col.find({ status: 'review' }).limit(200).toArray()) await pollOne(d)
  for (const d of await S.col.find({ status: { $in: ['active', 'paused'] }, nextBillAt: { $lte: new Date() } }).limit(200).toArray()) await billOne(d)
}

const findLive = (phone) => S?.col.findOne({ phoneNumber: normPhone(phone), status: { $in: ['active', 'paused'] } })

// Inbound text to a hosted number → the owner's web Inbox (answerable in place). true = handled.
async function onInbound({ from, to, body }) {
  if (!S) return false
  const d = await findLive(to)
  if (!d) return false
  if (d.status === 'paused') { S.log(`[HostedSMS] ${d.phoneNumber} paused — inbound from ${from} not delivered`); return true }
  await S.db.collection('phoneLogs').insertOne({ chatId: d.chatId, phoneNumber: d.phoneNumber, from, to: d.phoneNumber, type: 'sms', direction: 'inbound', body, hosted: true, timestamp: new Date() })
  await S.tell(d.chatId, `📩 SMS received\n\nTo: ${d.phoneNumber}\nFrom: ${from}\n\n"${body}"`, { kind: 'sms', meta: { from, to: d.phoneNumber, hosted: d._id } })
  return true
}

async function sendText(chatId, id, to, text) {
  const d = await mine(chatId, id)
  if (!d) return { error: 'That number isn’t on your account.' }
  if (d.status !== 'active') return { error: d.status === 'paused' ? `Texting is paused — the $${MONTHLY} monthly fee is due. Top up your wallet.` : 'This number isn’t active for texting yet.' }
  const dest = normPhone(to)
  const body = String(text || '').trim()
  if (!E164.test(dest)) return { error: 'Enter the number to text with its country code.' }
  if (!body) return { error: 'Type a message.' }
  if (body.length > MAX_TEXT) return { error: `Keep it to ${MAX_TEXT} characters (one text).` }
  if (!(await S.w.debit(chatId, TEXT_PRICE))) return { error: `Each text costs $${TEXT_PRICE.toFixed(2)}. Top up your wallet first.` }
  let mid = `preview-${crypto.randomUUID()}`
  if (!dry()) {
    try {
      const r = await axios.post(`${API}/messages`, { from: d.phoneNumber, to: dest, text: body, ...(process.env.TELNYX_MESSAGING_PROFILE_ID ? { messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID } : {}) }, { headers: { ...hdr(), 'Content-Type': 'application/json' }, timeout: 15000 })
      mid = r.data?.data?.id
    } catch (e) { await S.w.credit(chatId, TEXT_PRICE); return { error: `The text couldn’t be sent: ${errText(e)}` } }
  }
  const log = { chatId: String(chatId), phoneNumber: d.phoneNumber, from: d.phoneNumber, to: dest, type: 'sms_out', direction: 'outbound', body, messageId: mid, status: dry() ? 'preview' : 'sent', hosted: true, timestamp: new Date() }
  await S.db.collection('phoneLogs').insertOne(log)
  await txn(chatId, 'hosted-sms-text', TEXT_PRICE, { phoneNumber: d.phoneNumber, hostedId: d._id, to: dest })
  return { log, charge: TEXT_PRICE }
}

async function messages(chatId, id, limit = 50) {
  const d = await mine(chatId, id)
  if (!d) return null
  return S.db.collection('phoneLogs').find({ chatId: String(chatId), phoneNumber: d.phoneNumber, hosted: true }).sort({ timestamp: -1 }).limit(limit).toArray()
}

const api = { init, check, start, sendCode, submitCode, submitDocs, cancel, list, mine, pub, onInbound, sendText, messages, tick, buildLoa, normPhone, PRICE, MONTHLY, TEXT_PRICE, MAX_TEXT }
module.exports = api
