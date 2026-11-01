'use strict'
// Hosted SMS ("Landline to Texting"): the customer keeps their number + calls with their carrier, texting moves to Telnyx.
// Flow: pay → Telnyx code (phone call) → verified = straight to review; or skip → sign LOA in-app → bill upload
// (or ask support, who uploads it from admin) → Telnyx review → active. Rejected → full refund.
const axios = require('axios')
const crypto = require('crypto')
const FormData = require('form-data')
const { walletOps, round2 } = require('./cloudivr-web/wallet')

const PRICE = { code: 300, nocode: 500 } // legacy standalone setups (before plan pricing); MONTHLY still bills them
const MONTHLY = 50
// Plan pricing: one-time setup per number, attached to one of the customer's plan numbers and renewed with that plan.
const PLAN_PRICE = { starter: 150, pro: 120, business: 100 }
const PLAN_LIMIT = { starter: 5, pro: 10, business: null }
// Texting plan: standalone, one business number per plan, incoming texts only and free.
// $200 once (covers the first month), then $50/month.
const TEXTING = { setup: 200, monthly: 50 }
const monthlyOf = (d) => (d.planNumber ? 0 : d.plan === 'texting' ? TEXTING.monthly : MONTHLY)
const LIVE = ['starting', 'verify', 'loa', 'documents', 'admin_docs', 'review', 'active', 'paused']
const REVIEW_DAYS = '1–3 business days' // Telnyx reviews Mon–Fri, 9am–5pm US Central
const TEXT_PRICE = 0.05 // per text beyond any included ones
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
// Real Telnyx calls unless preview; realOrder lets a preview record drive a real Telnyx order.
const real = (d) => !dry() || !!d?.realOrder
const hdr = () => ({ Authorization: `Bearer ${process.env.TELNYX_API_KEY}` })
const normPhone = (p) => { const d = String(p || '').replace(/[^\d+]/g, ''); return d.startsWith('+') ? d : d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : `+${d}` }
const errText = (e) => { const x = e.response?.data?.errors?.[0]; return x ? `${x.title || ''} ${x.detail || ''}`.trim() : e.message }

let S = null // { db, col, w, log, tell, brand }

function init({ db, log = console.log, tell, brand, notifyAdmin, mailSupport }) {
  if (S) return api
  const col = db.collection('hostedSms')
  col.createIndex({ chatId: 1 }).catch(() => {})
  col.createIndex({ phoneNumber: 1, status: 1 }).catch(() => {})
  col.createIndex({ phoneNumber: 1 }, { unique: true, partialFilterExpression: { live: true }, name: 'one_live_per_number' }).catch(() => {})
  S = { db, col, w: walletOps(db), log, tell, brand, notifyAdmin, mailSupport }
  col.updateMany({ status: { $in: ['verify', 'loa', 'documents', 'admin_docs', 'review', 'active', 'paused'] }, live: { $exists: false } }, { $set: { live: true } }).catch(() => {})
  const t = setInterval(() => tick().catch(e => log(`[HostedSMS] tick: ${e.message}`)), dry() ? 30000 : 10 * 60000)
  t.unref?.()
  setTimeout(() => tick().catch(() => {}), 15000).unref?.()
  return api
}

const txn = (chatId, type, amount, meta) => S.db.collection('transactions').insertOne({ chatId: String(chatId), type, amount: round2(amount), currency: 'USD', status: 'completed', metadata: { ...meta, channel: 'hosted-sms' }, createdAt: new Date(), updatedAt: new Date() })
const pub = (d) => ({
  id: d._id, phoneNumber: d.phoneNumber, mode: d.mode, status: d.status, note: d.note || null, paid: d.paid,
  planNumber: d.planNumber || null, plan: d.plan || null,
  nextBillAt: d.nextBillAt || null, createdAt: d.createdAt, activatedAt: d.activatedAt || null, holder: d.holder || null,
  monthly: monthlyOf(d),
  noBill: !!d.noBill, signedAt: d.signedAt || null, docsAt: d.docsAt || null, expectedBy: d.docsAt ? addBusinessDays(d.docsAt, 3) : null,
})
// Telnyx reviews Mon–Fri only: "usually approved by" date for the customer.
function addBusinessDays(from, n) {
  const d = new Date(from)
  while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) n -= 1 }
  return d
}
// The customer's plan numbers, with how many texting numbers each already carries.
async function plansFor(chatId) {
  const nums = ((await S.db.collection('phoneNumbersOf').findOne({ _id: String(chatId) }))?.val?.numbers || []).filter(n => PLAN_PRICE[n.plan] && n.status !== 'released')
  const used = await S.col.aggregate([{ $match: { chatId: String(chatId), live: true, planNumber: { $in: nums.map(n => n.phoneNumber) } } }, { $group: { _id: '$planNumber', n: { $sum: 1 } } }]).toArray()
  const count = Object.fromEntries(used.map(u => [u._id, u.n]))
  const out = nums.map(n => ({ phoneNumber: n.phoneNumber, plan: n.plan, status: n.status, expiresAt: n.expiresAt || null, price: PLAN_PRICE[n.plan], limit: PLAN_LIMIT[n.plan], used: count[n.phoneNumber] || 0 }))
  return out
}
const mine = (chatId, id) => S.col.findOne({ _id: String(id), chatId: String(chatId) })
const list = async (chatId) => (await S.col.find({ chatId: String(chatId), status: { $nin: ['cancelled', 'starting'] } }).sort({ createdAt: -1 }).toArray()).map(pub)

async function check(phone) {
  const p = normPhone(phone)
  if (!E164.test(p)) return { eligible: false, phoneNumber: p, detail: 'Enter the full number with country code, e.g. +1 312 555 0100.' }
  if (await S.col.findOne({ phoneNumber: p, status: { $in: LIVE } })) return { eligible: false, phoneNumber: p, detail: 'This number is already being text-enabled.' }
  if (dry()) return { eligible: p.startsWith('+1'), phoneNumber: p, detail: p.startsWith('+1') ? 'Eligible (preview)' : 'Only US and Canada numbers can be text-enabled.' }
  try {
    const r = await axios.post(`${API}/messaging_hosted_number_orders/eligibility_numbers_check`, { phone_numbers: [p] }, { headers: hdr(), timeout: 20000 })
    const n = (r.data?.phone_numbers || r.data?.data?.phone_numbers || [])[0] || {}
    return { eligible: !!n.eligible, phoneNumber: p, detail: n.detail || n.eligible_status || '' }
  } catch (e) { return { eligible: false, phoneNumber: p, detail: `Couldn’t check right now: ${errText(e)}` } }
}

// Pays the setup and opens the Telnyx order.
// planNumber 'new' = start a Texting plan with this number; otherwise the plan number it joins.
async function start(chatId, phone, planNumber) {
  if (!require('./cloudivr-web/notify.js').isWebChatId(chatId)) return { error: 'Business texting is available on cloudivr.net.' }
  // Standalone only: every number is its own Texting plan.
  const parent = { phoneNumber: null, plan: 'texting', limit: null, price: TEXTING.setup }
  const el = await check(phone)
  if (!el.eligible) return { error: el.detail || 'This number can’t be text-enabled.' }
  const price = parent.price
  const _id = `hs_${crypto.randomBytes(6).toString('hex')}`
  // Claim the number first (unique while live) so two clicks can't pay twice.
  try { await S.col.insertOne({ _id, chatId: String(chatId), phoneNumber: el.phoneNumber, mode: null, planNumber: parent.phoneNumber, plan: parent.plan, status: 'starting', live: true, paid: 0, createdAt: new Date(), updatedAt: new Date() }) } catch (e) { if (e.code === 11000) return { error: 'This number is already being text-enabled.' }; throw e }
  // Re-count after claiming so parallel setups can't go over the plan's limit.
  if (parent.limit != null && (await S.col.countDocuments({ chatId: String(chatId), planNumber: parent.phoneNumber, live: true })) > parent.limit) { await S.col.deleteOne({ _id }); return { error: `Your ${parent.plan} plan on ${parent.phoneNumber} already has ${parent.limit} texting numbers.`, code: 'plan_limit' } }
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
  const doc = { _id, chatId: String(chatId), phoneNumber: el.phoneNumber, mode: null, planNumber: parent.phoneNumber, plan: parent.plan, status: 'verify', live: true, telnyxOrderId: orderId, paid: price, createdAt: new Date(), updatedAt: new Date() }
  await S.col.updateOne({ _id }, { $set: { status: doc.status, telnyxOrderId: orderId, paid: price, updatedAt: new Date() } })
  await txn(chatId, 'hosted-sms-setup', price, { phoneNumber: el.phoneNumber, hostedId: _id, planNumber: parent.phoneNumber, plan: parent.plan })
  S.log(`[HostedSMS] ${chatId} started ${el.phoneNumber} ($${price})`)
  return { item: pub(doc) }
}

// Eligible numbers are landlines / toll-free: the code always comes by phone call.
async function sendCode(chatId, id) {
  const method = 'call'
  const d = await mine(chatId, id)
  if (!d || d.status !== 'verify') return { error: 'Nothing to verify for this number.' }
  if (!real(d)) return { ok: true, method, preview: 'Preview: use code 123456' }
  try {
    await axios.post(`${API}/messaging_hosted_number_orders/${d.telnyxOrderId}/verification_codes`, { phone_numbers: [d.phoneNumber], verification_method: 'call' }, { headers: hdr(), timeout: 20000 })
    return { ok: true, method }
  } catch (e) { return { error: `Couldn’t send the code: ${errText(e)}` } }
}

async function submitCode(chatId, id, code) {
  const d = await mine(chatId, id)
  if (!d || d.status !== 'verify') return { error: 'Nothing to verify for this number.' }
  const c = String(code || '').replace(/\D/g, '')
  if (!c) return { error: 'Enter the code you received.' }
  let ok = !real(d) && c === '123456'
  if (real(d)) {
    try {
      const r = await axios.post(`${API}/messaging_hosted_number_orders/${d.telnyxOrderId}/validation_codes`, { verification_codes: [{ phone_number: d.phoneNumber, code: c }] }, { headers: hdr(), timeout: 20000 })
      const n = (r.data?.data?.phone_numbers || [])[0]
      ok = !n || n.status === 'verified'
    } catch (e) { return { error: `That code didn’t work: ${errText(e)}` } }
  }
  if (!ok) return { error: 'That code didn’t work. Check it or send a new one.' }
  // A verified code proves ownership: no letter or bill needed.
  const docsAt = new Date()
  await S.col.updateOne({ _id: d._id }, { $set: { status: 'review', mode: 'code', verifiedAt: docsAt, docsAt, note: null, updatedAt: docsAt } })
  S.tell(d.chatId, `✅ Ownership of ${d.phoneNumber} confirmed. The carrier usually approves texting within ${REVIEW_DAYS}. We’ll message you the moment it’s on.`, { kind: 'billing', meta: { hosted: d._id } })
  return { item: pub({ ...d, status: 'review', mode: 'code', docsAt }) }
}

// No code: prove ownership with a signed letter + phone bill instead.
async function skipCode(chatId, id) {
  const r = await S.col.findOneAndUpdate({ _id: String(id), chatId: String(chatId), status: 'verify' }, { $set: { status: 'loa', mode: 'nocode', updatedAt: new Date() } }, { returnDocument: 'after' })
  const d = r?.value || r
  return d?.status === 'loa' ? { item: pub(d) } : { error: 'Nothing to skip for this number.' }
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
async function buildLoa(d, holder, { ip, signature, signedAt } = {}) {
  const latin = (v) => String(v || '').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?')
  holder = Object.fromEntries(Object.entries(holder).map(([k, v]) => [k, latin(v)]))
  const sigName = latin(signature || holder.name)
  const at = signedAt ? new Date(signedAt) : new Date()
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const sig = await pdf.embedFont(StandardFonts.TimesRomanBoldItalic)
  const ink = rgb(0.06, 0.09, 0.16)
  let y = 740
  const line = (text, { f = font, size = 11, gap = 16, x = 56 } = {}) => { page.drawText(String(text), { x, y, size, font: f, color: ink, maxWidth: 500 }); y -= gap }
  const today = at.toISOString().slice(0, 10)
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
  page.drawText(sigName, { x: 56, y: y - 22, size: 24, font: sig, color: rgb(0.1, 0.15, 0.45) })
  y -= 34
  page.drawLine({ start: { x: 56, y }, end: { x: 330, y }, thickness: 0.8, color: ink })
  y -= 16
  line(`Printed name: ${holder.name}    Date: ${today}`, { size: 10 })
  y -= 10
  line(`Electronically signed by ${sigName} on ${at.toISOString()} from IP ${ip || 'n/a'}`, { size: 8, gap: 11 })
  line(`via ${S.brand?.() || 'CloudIVR'} — order ${d._id}. The signer confirmed the details and consented to an electronic signature.`, { size: 8, gap: 11 })
  pdf.setTitle(`LOA ${d.phoneNumber}`)
  return Buffer.from(await pdf.save())
}

// Step 3: the customer types their name to sign the letter; it's stored and sent with the bill.
async function signLoa(chatId, id, { holder: rawHolder, signature, consent, ip }) {
  const d = await mine(chatId, id)
  if (!d || !['loa', 'documents'].includes(d.status)) return { error: 'This number isn’t waiting for the authorization letter.' }
  if (!consent) return { error: 'Tick the box to sign the authorization letter.' }
  const { holder, error } = cleanHolder(rawHolder)
  if (error) return { error }
  const sig = String(signature || '').replace(/\s+/g, ' ').trim()
  if (sig.toLowerCase() !== holder.name.toLowerCase()) return { error: 'Type the account holder’s full name exactly to sign.' }
  const signedAt = new Date()
  await S.col.updateOne({ _id: d._id }, { $set: { status: 'documents', holder, signature: sig, signedAt, signedIp: ip || null, note: null, updatedAt: signedAt } })
  return { item: pub({ ...d, status: 'documents', holder, signedAt }) }
}

// Bill files (PDFs and/or photos) → one PDF.
async function toBillPdf(files) {
  if (!files?.length) return { error: 'Add the phone bill (PDF, JPG or PNG).' }
  const { PDFDocument } = require('pdf-lib')
  const out = await PDFDocument.create()
  for (const f of files) {
    const b = f.buffer
    if (b.slice(0, 5).toString() === '%PDF-') {
      try { const src = await PDFDocument.load(new Uint8Array(b), { ignoreEncryption: true }); (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p)) } catch (_) { return { error: `${f.originalname || 'A PDF'} couldn’t be read.` } }
      continue
    }
    const isPng = b[0] === 0x89 && b[1] === 0x50, isJpg = b[0] === 0xff && b[1] === 0xd8
    if (!isPng && !isJpg) return { error: `${f.originalname || 'A file'} isn’t a PDF, JPG or PNG.` }
    let img
    try { img = isPng ? await out.embedPng(new Uint8Array(b)) : await out.embedJpg(new Uint8Array(b)) } catch (_) { return { error: `${f.originalname || 'An image'} couldn’t be read — save it again as JPG or PNG.` } }
    const scale = Math.min(1, 560 / img.width, 740 / img.height)
    const page = out.addPage([612, 792])
    page.drawImage(img, { x: (612 - img.width * scale) / 2, y: (792 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale })
  }
  const bill = Buffer.from(await out.save())
  return bill.length > 5 * 1024 * 1024 ? { error: 'Together the files must be under 5 MB — use smaller photos.' } : { bill }
}

// Signed LOA + bill → Telnyx → review. Used by the customer and by admin (support handoff).
async function sendDocs(d, files, by) {
  if (!d.holder) return { error: 'The authorization letter hasn’t been signed yet.' }
  const { bill, error } = await toBillPdf(files)
  if (error) return { error }
  const loa = await buildLoa(d, d.holder, { ip: d.signedIp, signature: d.signature, signedAt: d.signedAt })
  if (real(d)) {
    try {
      const form = new FormData()
      form.append('loa', loa, { filename: `loa-${d._id}.pdf`, contentType: 'application/pdf' })
      form.append('bill', bill, { filename: `bill-${d._id}.pdf`, contentType: 'application/pdf' })
      await axios.post(`${API}/messaging_hosted_number_orders/${d.telnyxOrderId}/actions/file_upload`, form, { headers: { ...hdr(), ...form.getHeaders() }, timeout: 60000, maxBodyLength: 20 * 1024 * 1024 })
    } catch (e) { return { error: `Telnyx didn’t accept the documents: ${errText(e)}` } }
  }
  const docsAt = new Date()
  await S.col.updateOne({ _id: d._id }, { $set: { status: 'review', note: null, docsAt, ...(by ? { submittedBy: by } : {}), updatedAt: docsAt } })
  S.tell(d.chatId, `📨 The documents for ${d.phoneNumber} are with the carrier. Approval usually takes ${REVIEW_DAYS} — expected by ${addBusinessDays(docsAt, 3).toISOString().slice(0, 10)}. We’ll message you the moment texting is on.`, { kind: 'billing', meta: { hosted: d._id } })
  S.log(`[HostedSMS] documents sent for ${d.phoneNumber} (${d._id})${by ? ` by ${by}` : ''}`)
  return { item: pub({ ...d, status: 'review', docsAt }) }
}

async function submitDocs(chatId, id, files) {
  const d = await mine(chatId, id)
  if (!d || !['documents', 'admin_docs'].includes(d.status)) return { error: 'This number isn’t waiting for the phone bill.' }
  return sendDocs(d, files)
}

// Step 4 alternative: no bill at hand → support collects it and uploads it from admin.
async function requestHelp(chatId, id) {
  const d = await mine(chatId, id)
  if (!d || !['documents', 'admin_docs'].includes(d.status)) return { error: 'This number isn’t waiting for the phone bill.' }
  if (d.status === 'admin_docs') return { item: pub(d) }
  await S.col.updateOne({ _id: d._id }, { $set: { status: 'admin_docs', noBill: true, handoffAt: new Date(), updatedAt: new Date() } })
  const h = d.holder || {}
  const acct = (await S.db.collection('webAccounts').findOne({ _id: Number(d.chatId) }, { projection: { email: 1 } }).catch(() => null))?.email || d.chatId
  const lines = [`Number: ${d.phoneNumber}`, `Order: ${d._id} (Telnyx ${d.telnyxOrderId})`, `Customer: ${acct}`, `Holder: ${h.name || '—'}${h.business ? ` (${h.business})` : ''}`, `Address: ${[h.address, h.city, h.state, h.zip].filter(Boolean).join(', ')}`, `Carrier: ${h.carrier || '—'}`]
  try { S.notifyAdmin?.(`📄 <b>Landline to Texting — bill help</b>\n${lines.join('\n')}\nOpen cloudivr.net/admin → Texting to upload and submit.`) } catch (_) { /* best effort */ }
  S.mailSupport?.(`Phone bill help — ${d.phoneNumber}`, `<p>A customer needs help with the phone bill for Landline to Texting.</p><p>${lines.join('<br>')}</p><p>Upload it in cloudivr.net/admin → Texting → “Sign LOA & submit to Telnyx”.</p>`)?.catch?.(() => {})
  S.tell(d.chatId, `📄 Our team has your request for ${d.phoneNumber}. We’ll reply in your Inbox and by email within 1 business day — usually a photo or screenshot of your phone account is enough. You can still upload the bill yourself any time.`, { kind: 'billing', meta: { hosted: d._id } })
  return { item: pub({ ...d, status: 'admin_docs', noBill: true }) }
}

async function adminSubmitDocs(id, files, { admin } = {}) {
  const d = await S.col.findOne({ _id: String(id) })
  if (!d || !['admin_docs', 'documents'].includes(d.status)) return { error: 'This order isn’t waiting for documents.' }
  return sendDocs(d, files, admin || 'admin')
}

// Admin message to the customer (what proof to send, a question…). Lands in their Inbox/notifications.
async function adminMessage(id, text) {
  const d = await S.col.findOne({ _id: String(id) })
  if (!d) return { error: 'Order not found.' }
  await S.tell(d.chatId, `💬 CloudIVR about texting for ${d.phoneNumber}: ${String(text).slice(0, 1000)}`, { kind: 'billing', meta: { hosted: d._id } })
  return { ok: true }
}
async function adminReject(id, note) {
  const d = await S.col.findOne({ _id: String(id) })
  if (!d || !['verify', 'loa', 'documents', 'admin_docs', 'review'].includes(d.status)) return { error: 'Only orders not yet active can be rejected.' }
  return { item: pub(await reject(d, String(note || 'The setup was rejected.').slice(0, 300))) }
}

async function cancel(chatId, id) {
  const d = await mine(chatId, id)
  if (!d || !['verify', 'loa', 'documents', 'admin_docs'].includes(d.status)) return { error: 'Only setups that haven’t been sent for review can be cancelled.' }
  return { item: pub(await reject(d, null, 'cancelled')) }
}

async function reject(d, note, status = 'rejected') {
  const r = await S.col.findOneAndUpdate({ _id: d._id, status: { $in: ['verify', 'loa', 'documents', 'admin_docs', 'review'] } }, { $set: { status, note, refunded: d.paid, updatedAt: new Date() }, $unset: { live: '' } }, { returnDocument: 'after' })
  const doc = r?.value || r
  if (!doc || doc.status !== status) return d
  await S.w.credit(d.chatId, d.paid)
  await txn(d.chatId, 'hosted-sms-refund', d.paid, { phoneNumber: d.phoneNumber, hostedId: d._id })
  if (real(d) && d.telnyxOrderId) axios.delete(`${API}/messaging_hosted_number_orders/${d.telnyxOrderId}`, { headers: hdr(), timeout: 20000 }).catch(() => {})
  S.tell(d.chatId, status === 'cancelled' ? `↩️ Landline to Texting setup for ${d.phoneNumber} cancelled — $${d.paid} refunded to your wallet.` : `❌ Texting for ${d.phoneNumber} couldn’t be set up. ${note} $${d.paid} was refunded to your wallet.`, { kind: 'billing', meta: { hosted: d._id } })
  return doc
}

async function pollOne(d) {
  let st = null
  if (!real(d)) st = Date.now() - new Date(d.docsAt || d.updatedAt).getTime() > 60000 ? 'successful' : 'pending'
  else {
    try { st = (await axios.get(`${API}/messaging_hosted_number_orders/${d.telnyxOrderId}`, { headers: hdr(), timeout: 20000 })).data?.data?.status } catch (e) { return }
  }
  if (st === 'successful') {
    const r = await S.col.updateOne({ _id: d._id, status: 'review' }, { $set: { status: 'active', note: null, activatedAt: new Date(), ...(d.planNumber ? {} : { nextBillAt: new Date(Date.now() + MONTH_MS), inboundUsed: 0 }), updatedAt: new Date() } })
    if (r.modifiedCount) S.tell(d.chatId, `✅ ${d.phoneNumber} is on. Texts your customers send it now land here and in your Inbox, free. ${d.planNumber ? `No monthly fee: it renews with your plan on ${d.planNumber}.` : `Your first month is included; then $${monthlyOf(d)}/month from your wallet, next on ${new Date(Date.now() + MONTH_MS).toISOString().slice(0, 10)}.`}`, { kind: 'billing', meta: { hosted: d._id } })
  } else if (FIX_DOCS.includes(st) && d.status === 'review') {
    const back = st === 'loa_file_invalid' ? 'loa' : d.noBill ? 'admin_docs' : 'documents'
    await S.col.updateOne({ _id: d._id }, { $set: { status: back, note: REASON[st], updatedAt: new Date() } })
    S.tell(d.chatId, `⚠️ ${d.phoneNumber}: ${REASON[st]} Please ${back === 'loa' ? 'sign the letter' : 'send the phone bill'} again — no extra charge.`, { kind: 'billing', meta: { hosted: d._id } })
  } else if (REJECTED.includes(st)) {
    await reject(d, REASON[st] || 'Telnyx rejected the request.')
  }
}

async function billOne(d) {
  if (d.status === 'paused' && !(d.retryAt && new Date(d.retryAt) <= new Date())) return
  const r = await S.col.updateOne({ _id: d._id, nextBillAt: d.nextBillAt, status: d.status }, { $set: { billingAt: new Date() } })
  if (!r.modifiedCount) return
  const fee = monthlyOf(d)
  if (await S.w.debit(d.chatId, fee)) {
    const next = new Date(Math.max(Date.now(), new Date(d.nextBillAt).getTime()) + MONTH_MS)
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'active', nextBillAt: next, retryAt: null, inboundUsed: 0, updatedAt: new Date() } })
    await txn(d.chatId, 'hosted-sms-renewal', fee, { phoneNumber: d.phoneNumber, hostedId: d._id })
    if (d.status === 'paused') S.tell(d.chatId, `✅ Texting on ${d.phoneNumber} is back on — $${fee} paid from your wallet.`, { kind: 'billing', meta: { hosted: d._id } })
  } else {
    await S.col.updateOne({ _id: d._id }, { $set: { status: 'paused', retryAt: new Date(Date.now() + 86400000), updatedAt: new Date() } })
    if (d.status !== 'paused') S.tell(d.chatId, `⏸ Texting on ${d.phoneNumber} is paused: the $${fee} monthly fee couldn’t be paid from your wallet. Top up and it turns back on within a day.`, { kind: 'billing', meta: { hosted: d._id } })
  }
}

// Plan-attached numbers: texting is on while the parent plan number is active, paused while it is expired/suspended/gone.
async function syncPlan(d) {
  const parent = d.plan === 'texting'
    ? await S.col.findOne({ chatId: d.chatId, phoneNumber: d.planNumber, live: true, planNumber: null })
    : ((await S.db.collection('phoneNumbersOf').findOne({ _id: d.chatId }))?.val?.numbers || []).find(n => n.phoneNumber === d.planNumber && n.status !== 'released')
  const on = parent?.status === 'active'
  if (on === (d.status === 'active')) return
  await S.col.updateOne({ _id: d._id, status: d.status }, { $set: { status: on ? 'active' : 'paused', note: on ? null : `Paused: the plan on ${d.planNumber} isn’t active.`, updatedAt: new Date() } })
  S.tell(d.chatId, on ? `✅ Texting on ${d.phoneNumber} is back on — your plan on ${d.planNumber} is active again.` : `⏸ Texting on ${d.phoneNumber} is paused because the plan on ${d.planNumber} isn’t active. Renew the plan and texting turns back on by itself.`, { kind: 'billing', meta: { hosted: d._id } })
}

async function tick() {
  for (const d of await S.col.find({ status: 'review' }).limit(200).toArray()) await pollOne(d)
  for (const d of await S.col.find({ status: { $in: ['active', 'paused'] }, planNumber: null, nextBillAt: { $lte: new Date() } }).limit(200).toArray()) await billOne(d)
  for (const d of await S.col.find({ status: { $in: ['active', 'paused'] }, planNumber: { $ne: null } }).limit(500).toArray()) await syncPlan(d)
}

const findLive = (phone) => S?.col.findOne({ phoneNumber: normPhone(phone), status: { $in: ['active', 'paused'] } })

// Inbound text to a hosted number → the owner's web Inbox (answerable in place). true = handled.
async function onInbound({ from, to, body }) {
  if (!S) return false
  const d = await findLive(to)
  if (!d) return false
  if (d.status === 'paused') { S.log(`[HostedSMS] ${d.phoneNumber} paused — inbound from ${from} not delivered`); return true }
  // Incoming texts are free on the Texting plan (older add-on numbers still pay per text).
  const free = true
  const charge = free ? 0 : TEXT_PRICE
  // Receiving costs the same as sending. No balance → the text isn't delivered; one "top up" notice per day.
  if (!free && !(await S.w.debit(d.chatId, TEXT_PRICE))) {
    S.log(`[HostedSMS] ${d.phoneNumber} inbound from ${from} not delivered — wallet can't cover $${TEXT_PRICE}`)
    const r = await S.col.updateOne({ _id: d._id, $or: [{ lowBalanceAt: null }, { lowBalanceAt: { $lt: new Date(Date.now() - 86400000) } }] }, { $set: { lowBalanceAt: new Date() } })
    if (r.modifiedCount) S.tell(d.chatId, `⚠️ A text to ${d.phoneNumber} couldn’t be delivered — each received text costs $${TEXT_PRICE.toFixed(2)} and your wallet is empty. Top up to keep receiving texts.`, { kind: 'billing', meta: { hosted: d._id } })
    return true
  }
  if (!free) await txn(d.chatId, 'hosted-sms-inbound', TEXT_PRICE, { phoneNumber: d.phoneNumber, hostedId: d._id, from })
  await S.db.collection('phoneLogs').insertOne({ chatId: d.chatId, phoneNumber: d.phoneNumber, from, to: d.phoneNumber, type: 'sms', direction: 'inbound', body, hosted: true, charge, timestamp: new Date() })
  await S.tell(d.chatId, `📩 SMS received\n\nTo: ${d.phoneNumber}\nFrom: ${from}\n\n"${body}"`, { kind: 'sms', meta: { from, to: d.phoneNumber, hosted: d._id, receiveOnly: true } })
  return true
}

async function sendText(chatId, id, to, text) {
  const d = await mine(chatId, id)
  if (!d) return { error: 'That number isn’t on your account.' }
  return { error: 'This number receives texts only. Your customers text it and you read them here.', code: 'receive_only' }
  if (d.status !== 'active') return { error: d.status === 'paused' ? (d.planNumber ? `Texting is paused because the plan on ${d.planNumber} isn’t active. Renew the plan and it turns back on.` : `Texting is paused — the $${monthlyOf(d)} monthly fee is due. Top up your wallet.`) : 'This number isn’t active for texting yet.' }
  const dest = normPhone(to)
  const body = String(text || '').trim()
  if (!E164.test(dest)) return { error: 'Enter the number to text with its country code.' }
  if (!body) return { error: 'Type a message.' }
  if (body.length > MAX_TEXT) return { error: `Keep it to ${MAX_TEXT} characters (one text).` }
  const senderName = (await S.db.collection('webPrefs').findOne({ _id: chatId }, { projection: { senderName: 1 } }))?.senderName || null
  const rule = await require('./sms-rules.js').check(d.phoneNumber, dest, senderName, true)
  if (!rule.ok) return { error: rule.why }
  const price = rule.price
  if (!(await S.w.debit(chatId, price))) return { error: `A text to ${rule.country} costs $${price.toFixed(2)}. Top up your wallet first.` }
  let mid = `preview-${crypto.randomUUID()}`
  if (!dry()) {
    try {
      const r = await axios.post(`${API}/messages`, { from: rule.from || d.phoneNumber, to: dest, text: body, ...(process.env.TELNYX_MESSAGING_PROFILE_ID ? { messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID } : {}) }, { headers: { ...hdr(), 'Content-Type': 'application/json' }, timeout: 15000 })
      mid = r.data?.data?.id
    } catch (e) { await S.w.credit(chatId, price); return { error: `The text couldn’t be sent: ${errText(e)}` } }
  }
  const log = { chatId: String(chatId), phoneNumber: d.phoneNumber, from: rule.from || d.phoneNumber, to: dest, country: rule.iso, charge: price, type: 'sms_out', direction: 'outbound', body, messageId: mid, status: dry() ? 'preview' : 'sent', hosted: true, timestamp: new Date() }
  await S.db.collection('phoneLogs').insertOne(log)
  await txn(chatId, 'hosted-sms-text', price, { phoneNumber: d.phoneNumber, hostedId: d._id, to: dest, country: rule.iso })
  return { log, charge: price }
}

async function messages(chatId, id, limit = 50) {
  const d = await mine(chatId, id)
  if (!d) return null
  return S.db.collection('phoneLogs').find({ chatId: String(chatId), phoneNumber: d.phoneNumber, hosted: true }).sort({ timestamp: -1 }).limit(limit).toArray()
}

const api = { init, check, start, sendCode, submitCode, skipCode, signLoa, submitDocs, requestHelp, cancel, adminSubmitDocs, adminMessage, adminReject, addBusinessDays, REVIEW_DAYS, list, mine, pub, onInbound, sendText, messages, tick, buildLoa, normPhone, PRICE, MONTHLY, TEXT_PRICE, MAX_TEXT, PLAN_PRICE, PLAN_LIMIT, TEXTING, plansFor }
module.exports = api
