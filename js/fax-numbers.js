'use strict'
// Fax-only numbers (MultiTEL; web + bots): search, buy from the wallet, monthly renewal, release. Countries needing no ID or
// just a name + address; those needing registration wait for the carrier and are refunded in full if rejected.
// They sit on the Fax Application, so they send and receive faxes only — no calls, no texts, no SIP.
const crypto = require('crypto')
const telnyxAcct = require('./telnyx-fax-account')
const swFax = require('./signalwire/fax')
const mtFax = require('./multitel/fax')
// New fax numbers come from MultiTEL only; numbers bought earlier on SignalWire / Telnyx stay where they are.
const ibFax = () => (require('./infobip/fax').enabled() ? require('./infobip/fax') : null) // FAX_PROVIDER=infobip
const acct = { enabled: () => !!ibFax() || (mtFax.enabled() && require('./multitel').selling()), searchFax: (...a) => (ibFax() || mtFax).searchFax(...a) }
const releaseFor = (n) => (n.provider === 'infobip_fax' ? require('./infobip/fax').releaseFax(n.phoneNumber) : n.provider === 'multitel_fax' ? mtFax.releaseFax(n.phoneNumber) : n.provider === 'signalwire_fax' ? swFax.releaseFax(n.phoneNumber) : telnyxAcct.releaseFax(n.phoneNumber))
const fax = require('./fax-service')
const { walletOps, round2 } = require('./cloudivr-web/wallet')

const PRICE = () => round2(Number(process.env.FAX_NUMBER_PRICE) || 50)
// Fax (T.38) offers from the 15 Nov 2026 MultiTEL scan (memory/MULTITEL_FAX_COUNTRIES_2026-11-15.md), paperwork level 0–1 only.
const FAX_TYPES = { US: ['local'], CA: ['local'], GB: ['local', 'national', 'mobile'], NL: ['local', 'national', 'mobile'], IE: ['local', 'national'], AR: ['local'], SV: ['local'], IS: ['local'], VN: ['local'], DK: ['national'], LT: ['local', 'mobile'], AU: ['local', 'mobile'], GR: ['local'], NZ: ['local'], EE: ['national'],
  // ID / company documents (uploaded once per country, reused): 
  DE: ['local', 'national'], FR: ['local'], IT: ['local'], PL: ['local'], ZA: ['local'], SG: ['local'], TH: ['local', 'national'], FI: ['local', 'national'], LV: ['local'], HR: ['local'], UA: ['local', 'mobile'], HK: ['national'], SK: ['local'], AL: ['local'] }
const TYPE_LABEL = { local: 'Local', national: 'National', mobile: 'Mobile' }
const { NAMES, offer: mtOffer } = require('./multitel/countries')
const offerOf = (cc, type) => { if (ibFax()) return ibFax().COUNTRIES.find(c => c.code === cc) && type === 'local' ? { level: 0 } : null; const o = FAX_TYPES[cc]?.includes(type) ? mtOffer(cc, type) : null; return o && o.level <= 2 ? o : null }
const MT_COUNTRIES = Object.keys(FAX_TYPES).map(code => ({ code, name: NAMES[code] || code, areaCodes: ['US', 'CA'].includes(code),
  types: FAX_TYPES[code].filter(t => offerOf(code, t)).map(t => { const o = offerOf(code, t); return { type: t, label: TYPE_LABEL[t], paperwork: ['none', 'name_address', 'documents'][o.level], businessOnly: o.businessOnly, address: o.address } }) }))
  .sort((a, b) => (a.code === 'US' ? -1 : b.code === 'US' ? 1 : a.name.localeCompare(b.name)))
const COUNTRIES = ibFax() ? ibFax().COUNTRIES : MT_COUNTRIES
// Saved name + address vs the offer's rules → message, or null when it can buy.
function paperworkIssue(cc, type, eu, { docs = 0, signature = true } = {}) {
  const o = offerOf(cc, type), name = NAMES[cc] || cc
  if (!o?.level) return null
  if (!eu?.name || !eu?.address) return `${name} fax numbers need your name and address.`
  if (o.level === 2 && !docs) return `${name} fax numbers need ID or company documents. Upload them first.`
  if (!signature) return `${name} fax numbers need your signature for the carrier registration.`
  if (o.businessOnly && eu.type !== 'business') return `${name} fax numbers are sold to businesses only.`
  if (o.address !== 'any' && eu.countryCode && eu.countryCode !== cc) return `${name} fax numbers need an address in ${name}.`
  return null
}
const GRACE_MS = 3 * 86400000
const DETAILS_DAYS = 14
const dry = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const nextMonth = (from = new Date()) => { const d = new Date(from); d.setMonth(d.getMonth() + 1); return d.toISOString() }

class FaxNumberError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code } }

function create(db, { log = console.log, notifyAdmin = () => {}, push = () => {}, sweep = true } = {}) {
  const nums = db.collection('faxNumbers'), cache = db.collection('faxNumberSearch'), locks = db.collection('webNumberLocks'), seen = db.collection('faxNumberSeen')
  seen.createIndex({ at: 1 }, { expireAfterSeconds: 2 * 3600 }).catch(() => {})
  const w = walletOps(db)
  nums.createIndex({ chatId: 1 }).catch(() => {})

  // Paid numbers whose country needs details: the carrier step comes after payment (needsDetails → form in bot/web).
  const regOf = (n) => (n.status === 'pending_registration' ? { needsDetails: n.registration?.status === 'needs_details', paperwork: ['none', 'name_address', 'documents'][n.registration?.level || offerOf(n.country, n.type || 'local')?.level || 0], businessOnly: !!offerOf(n.country, n.type || 'local')?.businessOnly, address: offerOf(n.country, n.type || 'local')?.address || 'any', refundBy: n.registration?.status === 'needs_details' ? new Date(new Date(n.registration.since).getTime() + DETAILS_DAYS * 864e5).toISOString() : null } : null)
  const pub = (n) => ({ phoneNumber: n.phoneNumber, country: n.country, type: n.type || 'local', status: n.status, registration: regOf(n), price: n.price, autoRenew: n.autoRenew !== false, expiresAt: n.expiresAt, createdAt: n.createdAt, faxOnly: true, capabilities: { voice: false, sms: false, fax: true } })
  const list = async (chatId) => (await nums.find({ chatId: String(chatId), status: { $ne: 'released' } }).sort({ createdAt: -1 }).toArray()).map(pub)
  const offer = ({ withPaperwork = false } = {}) => ({ available: acct.enabled(), price: PRICE(), countries: withPaperwork ? COUNTRIES : COUNTRIES.map(c => ({ ...c, types: c.types.map(({ type, label }) => ({ type, label })) })), freePages: fax.FREE_PAGES, pagePrice: fax.PAGE_PRICE })
  const cache2 = (chatId) => cache.findOne({ _id: String(chatId) })

  async function search(chatId, country, areaCode, type = 'local') {
    if (!acct.enabled()) throw new FaxNumberError(503, 'unavailable', 'Fax numbers are not available right now. Please try again later.')
    const cc = String(country || 'US').toUpperCase()
    const c = COUNTRIES.find(x => x.code === cc)
    if (!c) throw new FaxNumberError(400, 'invalid_country', 'Fax numbers are not sold in that country.')
    const t = c.types.some(x => x.type === type) ? type : c.types[0].type
    const ac = c.areaCodes && /^\d{3}$/.test(String(areaCode || '')) ? String(areaCode) : null
    let found
    try { found = await acct.searchFax(cc, ac, 12, t) } catch (e) {
      log(`[FaxNumbers] search ${cc}${ac ? ` ${ac}` : ''} failed: ${e.response?.data?.errors?.[0]?.detail || e.message}`)
      throw new FaxNumberError(503, 'unavailable', 'Fax numbers could not be searched right now. Please try again in a minute.')
    }
    const held = new Set((await nums.find({ _id: { $in: found.map(n => n.phoneNumber) }, status: { $ne: 'released' } }, { projection: { _id: 1 } }).toArray()).map(d => d._id))
    const results = found.filter(n => !held.has(n.phoneNumber)).map(({ phoneNumber, region, nearby, assigned }) => ({ phoneNumber, region, nearby, assigned, capabilities: { voice: false, sms: false, fax: true } }))
    // Visitor searches (no account yet) are remembered per number for 2 hours, so the pick survives sign-up.
    if (chatId) await cache.updateOne({ _id: String(chatId) }, { $set: { country: cc, type: t, results, at: new Date() } }, { upsert: true })
    else if (results.length) await seen.bulkWrite(results.map(r => ({ updateOne: { filter: { _id: r.phoneNumber }, update: { $set: { country: cc, type: t, region: r.region, at: new Date() } }, upsert: true } }))).catch(() => {})
    return { numbers: results, price: PRICE(), type: t, areaCode: ac, nearbyOnly: !!ac && results.length > 0 && results.every(n => n.nearby) }
  }

  async function buy(chatId, { phoneNumber, autoRenew = true, email = '', endUser = null, person = null }) {
    chatId = String(chatId)
    let c = await cache.findOne({ _id: chatId })
    let hit = c?.results?.find(r => r.phoneNumber === phoneNumber)
    if (!hit) { const v = await seen.findOne({ _id: phoneNumber }); if (v) { c = { country: v.country, type: v.type }; hit = { phoneNumber } } }
    if (!hit) throw new FaxNumberError(400, 'search_again', 'That number is no longer in your search results. Search again and pick a number.')
    const type = c.type || 'local', o = offerOf(c.country, type)
    const docs = o?.level === 2 ? ((await db.collection('numberDocs').findOne({ _id: `${chatId}:${c.country}` }))?.files || []).filter(f => !f.deleted) : []
    // Details given up front are used; otherwise they are asked for after payment (never blocks the order).
    const ready = !!o?.level && !!endUser && !paperworkIssue(c.country, type, endUser, { docs: docs.length, signature: !!person?.signature })
    let needsReg = !!o?.level || !!require('./multitel').searchedMeta(phoneNumber)?.needsReg
    try { await locks.insertOne({ _id: phoneNumber, chatId, at: new Date() }) } catch (e) {
      if (e.code === 11000) throw new FaxNumberError(409, 'number_taken', 'Someone is buying that number right now. Pick another one.')
      throw e
    }
    const price = PRICE()
    try {
      if (await nums.findOne({ _id: phoneNumber, status: { $ne: 'released' } })) throw new FaxNumberError(409, 'number_taken', 'Someone just took that number. Pick another one.')
      if (!(await w.debit(chatId, price))) throw new FaxNumberError(402, 'insufficient_balance', `This fax number costs $${price.toFixed(2)}/month. Your wallet has $${(await w.balance(chatId)).toFixed(2)} — top up first.`)
      let orderId, real = phoneNumber
      try {
        if (dry()) orderId = `dryrun-${crypto.randomUUID().slice(0, 8)}`
        else { const o = await (ibFax() || mtFax).orderFax(phoneNumber); orderId = o?.id; real = o?.phoneNumber || phoneNumber; if (o?.needsReg) needsReg = true }
        if (!orderId) throw new Error('no order id')
      } catch (e) {
        const why = e.response?.data?.errors?.[0]?.detail || e.response?.data?.message || e.message
        if (ibFax() && !dry()) {
          // Supplier failure (low balance, outage…): keep the paid order and finish it automatically (refund after 24 h).
          log(`[FaxNumbers] order ${phoneNumber} for ${chatId} failed: ${why} — waiting in the pending queue`)
          const pend = require('./pending-orders'), order = pend.pendingResult('infobip_fax', phoneNumber, { country: c.country, type })
          const doc = { _id: phoneNumber, phoneNumber, chatId, country: c.country, type, status: 'provisioning', faxOnly: true, plan: 'fax', price, autoRenew: autoRenew !== false, provider: 'infobip_fax', mtNumberId: null, expiresAt: nextMonth(), createdAt: new Date() }
          await nums.replaceOne({ _id: phoneNumber }, doc, { upsert: true })
          await pend.enqueue({ chatId, phoneNumber, order, amount: price, email, kind: 'fax' })
          await db.collection('transactions').insertOne({ chatId, type: 'fax-number', amount: price, currency: 'USD', status: 'completed', metadata: { phoneNumber, provider: 'infobip_fax', pending: true }, createdAt: new Date() })
          await cache.deleteOne({ _id: chatId })
          return { number: pub(doc), pending: true, balance: await w.balance(chatId) }
        }
        await w.credit(chatId, price)
        log(`[FaxNumbers] order ${phoneNumber} for ${chatId} failed: ${why} — refunded $${price}`)
        throw new FaxNumberError(424, 'purchase_failed', `This fax number could not be activated. You were refunded $${price.toFixed(2)}. Pick another number.`)
      }
      const doc = { _id: real, phoneNumber: real, chatId, country: c.country, type, status: needsReg ? 'pending_registration' : 'active', faxOnly: true, plan: 'fax', price, autoRenew: autoRenew !== false, provider: ibFax() ? 'infobip_fax' : 'multitel_fax', mtNumberId: orderId, expiresAt: nextMonth(), createdAt: new Date(), ...(endUser ? { endUser } : {}), ...(person ? { person: { ...person, signature: undefined } } : {}), ...(needsReg ? { registration: { status: o?.level && !ready ? 'needs_details' : 'pending', level: o?.level || 0, since: new Date() } } : {}), ...(dry() ? { dryRun: true } : {}) }
      await nums.replaceOne({ _id: real }, doc, { upsert: true })
      if (needsReg && (!o?.level || ready)) await sendRegistration(doc, email, person, docs)
      await db.collection('transactions').insertOne({ chatId, type: 'fax-number', amount: price, currency: 'USD', status: 'completed', metadata: { phoneNumber: real, provider: ibFax() ? 'infobip_fax' : 'multitel_fax' }, createdAt: new Date(), updatedAt: new Date() }).catch(() => {})
      await cache.deleteOne({ _id: chatId }); await seen.deleteOne({ _id: phoneNumber }).catch(() => {})
      notifyAdmin(`📠 Fax number${dry() ? ' (DRY RUN)' : ''}${needsReg ? ' — waiting for carrier registration' : ''}\naccount: ${chatId}${email ? ` (${email})` : ''}\nnumber: ${real} (${c.country} ${type}) · $${price}/month`)
      return { number: pub(doc), balance: await w.balance(chatId) }
    } finally { await locks.deleteOne({ _id: phoneNumber }).catch(() => {}) }
  }

  async function setAutoRenew(chatId, phoneNumber, on) {
    const r = await nums.findOneAndUpdate({ _id: phoneNumber, chatId: String(chatId), status: { $ne: 'released' } }, { $set: { autoRenew: !!on } }, { returnDocument: 'after', includeResultMetadata: false })
    if (!r) throw new FaxNumberError(404, 'not_found', 'Fax number not found on your account.')
    return pub(r)
  }

  async function release(n, why) {
    try { if (!n.dryRun) await releaseFor(n) } catch (e) { log(`[FaxNumbers] release ${n.phoneNumber} failed: ${e.message}`); return }
    await nums.updateOne({ _id: n._id }, { $set: { status: 'released', releasedAt: new Date(), releaseReason: why } })
    await push(n.chatId, `Fax number ${n.phoneNumber} was released${why === 'unpaid' ? ' because the monthly fee could not be paid from your wallet' : ''}.`)
  }

  // Name + address to MultiTEL's registration desk (their documented route for numbers that need end-user details).
  async function sendRegistration(n, email, person, docs = []) {
    if (n.dryRun) return
    const files = []
    for (const f of docs) files.push({ buffer: await require('./cloudivr-web/number-docs').get(f.path), name: f.name, type: f.type })
    // Preferred: the customer's MultiTEL registration profile (created once, reused) attached to the number.
    if (person) {
      try {
        const r = await require('./multitel/identity').registerNumber(db, { chatId: n.chatId, phoneNumber: n.phoneNumber, person: { ...person, email: person.email || email }, files })
        await nums.updateOne({ _id: n._id }, { $set: { 'registration.via': 'api', 'registration.profile': r.profile, 'registration.sent': true, 'registration.sentAt': new Date() } })
        notifyAdmin(`📄 Fax number registration submitted (customer profile): ${n.phoneNumber} (${n.country}) — account ${n.chatId}`)
        return
      } catch (e) { log(`[FaxNumbers] profile registration ${n.phoneNumber} failed, emailing instead: ${e.message}`) }
    }
    const eu = n.endUser || {}, from = process.env.CLOUDIVR_MAIL_SENDER || process.env.MAIL_SENDER
    const html = `<p>Hello MultiTEL team,</p><p>Please register this fax number for its end user.</p><ul><li>Number: <b>${n.phoneNumber}</b> (${NAMES[n.country] || n.country} ${n.type})</li><li>End user type: ${eu.type || '-'}</li><li>Name: ${eu.name || '-'}</li>${eu.contact ? `<li>Contact person: ${eu.contact}</li>` : ''}<li>Address: ${eu.address || '-'}</li>${email ? `<li>Contact email: ${email}</li>` : ''}</ul><p>Thank you</p>`
    const sent = await require('./mailer').send({ from: { name: process.env.MAIL_SENDER_NAME || 'CloudIVR', email: from }, to: process.env.MULTITEL_DOCS_EMAIL || 'support@multitel.net', subject: `DID registration: ${n.phoneNumber} (${NAMES[n.country] || n.country})`, html, ...(files.length ? { attachments: files.map(f => ({ filename: f.name, content: f.buffer.toString('base64') })) } : {}) }).then(() => true, e => { log(`[FaxNumbers] registration email ${n.phoneNumber}: ${e.message}`); return false })
    await nums.updateOne({ _id: n._id }, { $set: { 'registration.sent': sent, 'registration.sentAt': new Date() } })
    notifyAdmin(`📄 Fax number registration ${sent ? 'sent to MultiTEL' : 'NOT sent (email failed)'}: ${n.phoneNumber} (${n.country}) — account ${n.chatId}`)
  }

  // Details after payment → checked like before, then sent to the carrier.
  async function submitDetails(chatId, phoneNumber, { endUser, person = null, email = '' }) {
    const n = await nums.findOne({ _id: phoneNumber, chatId: String(chatId), status: 'pending_registration', 'registration.status': 'needs_details' })
    if (!n) throw new FaxNumberError(404, 'not_found', 'No fax number is waiting for your details.')
    const docs = (n.registration.level === 2 ? (await db.collection('numberDocs').findOne({ _id: `${chatId}:${n.country}` }))?.files || [] : []).filter(f => !f.deleted)
    const why = paperworkIssue(n.country, n.type || 'local', endUser, { docs: docs.length, signature: !!person?.signature })
    if (why) throw new FaxNumberError(400, 'paperwork_needed', why)
    await nums.updateOne({ _id: n._id }, { $set: { endUser, ...(person ? { person: { ...person, signature: undefined } } : {}), 'registration.status': 'pending', 'registration.detailsAt': new Date() } })
    await sendRegistration({ ...n, endUser }, email, person, docs)
    return pub(await nums.findOne({ _id: n._id }))
  }
  // Waiting for the carrier (not live yet) → customer may cancel: released + full refund.
  async function cancelPending(chatId, phoneNumber, why = 'cancelled_by_customer') {
    const n = await nums.findOneAndUpdate({ _id: phoneNumber, ...(chatId ? { chatId: String(chatId) } : {}), status: 'pending_registration' }, { $set: { status: 'released', releasedAt: new Date(), releaseReason: why, 'registration.status': why } }, { returnDocument: 'after', includeResultMetadata: false })
    if (!n) throw new FaxNumberError(404, 'not_found', 'Only a fax number that is not live yet can be cancelled for a refund.')
    if (!n.dryRun) await releaseFor(n).catch(e => log(`[FaxNumbers] release ${n.phoneNumber}: ${e.message}`))
    await w.credit(n.chatId, n.price)
    notifyAdmin(`↩️ Fax number ${n.phoneNumber} cancelled (${why}) — refunded $${n.price} to ${n.chatId}`)
    return { refunded: n.price, balance: await w.balance(n.chatId) }
  }
  // Same reminder by email (web accounts have no Telegram chat).
  async function mailDetails(n) {
    const a = await db.collection('webAccounts').findOne({ _id: Number(n.chatId) }, { projection: { email: 1 } }).catch(() => null)
    if (!a?.email) return
    const site = String(process.env.CLOUDIVR_PUBLIC_URL || 'https://cloudivr.net').replace(/\/+$/, '')
    await require('./cloudivr-web/auth').sendMail(a.email, `Finish switching on fax number ${n.phoneNumber}`, `<p>Your fax number <b>${n.phoneNumber}</b> is paid and reserved. The carrier just needs your details to switch it on.</p><p><a href="${site}/app/fax">Open Fax numbers to finish</a> — it takes about 2 minutes. You can also cancel it there for a full refund.</p>`).catch(e => log(`[FaxNumbers] details mail: ${e.message}`))
  }
  // Paid but details never sent: reminders after 1 and 3 days, refund after DETAILS_DAYS.
  async function chaseDetails(now = Date.now()) {
    for (const n of await nums.find({ status: 'pending_registration', 'registration.status': 'needs_details' }).limit(200).toArray()) {
      const age = now - new Date(n.registration.since).getTime()
      if (age >= DETAILS_DAYS * 864e5) {
        const r = await cancelPending(null, n.phoneNumber, 'details_missing').catch(() => null)
        if (r) await push(n.chatId, `We didn't receive the carrier details for fax number ${n.phoneNumber}, so we released it and refunded $${n.price.toFixed(2)} to your wallet.`)
      } else for (const [k, d] of [['remind2', 3], ['remind1', 1]]) {
        if (age < d * 864e5 || n.registration[k]) continue
        const u = await nums.updateOne({ _id: n._id, [`registration.${k}`]: { $exists: false } }, { $set: { 'registration.remind1': true, [`registration.${k}`]: true } })
        if (u.modifiedCount) await mailDetails(n)
        if (u.modifiedCount) await push(n.chatId, `Fax number ${n.phoneNumber} is paid and reserved — the carrier just needs a few details to switch it on. Open Fax numbers to finish (takes 2 minutes), or cancel it there for a full refund. Without the details it is refunded automatically after ${DETAILS_DAYS} days.`)
        break
      }
    }
  }
  // Waiting registrations: approved → live (the month starts now); rejected → released + full refund.
  async function checkRegistrations() {
    const mt = require('./multitel')
    for (const n of await nums.find({ status: 'pending_registration', 'registration.status': { $ne: 'needs_details' }, dryRun: { $ne: true } }).limit(50).toArray()) {
      const st = await mt.registrationStatus(n.phoneNumber).catch(() => ({ state: 'pending' }))
      if (st.state === 'active') {
        await nums.updateOne({ _id: n._id, status: 'pending_registration' }, { $set: { status: 'active', expiresAt: nextMonth(), 'registration.status': 'approved', 'registration.decidedAt': new Date() } })
        await push(n.chatId, `Your fax number ${n.phoneNumber} was approved by the carrier and can send and receive faxes now.`)
      } else if (st.state === 'rejected') {
        const u = await nums.updateOne({ _id: n._id, status: 'pending_registration' }, { $set: { status: 'released', releasedAt: new Date(), releaseReason: 'registration_rejected', 'registration.status': 'rejected', 'registration.raw': st.raw } })
        if (!u.modifiedCount) continue
        await releaseFor(n).catch(() => {})
        await w.credit(n.chatId, n.price)
        await push(n.chatId, `The carrier did not approve fax number ${n.phoneNumber}. We released it and refunded $${n.price.toFixed(2)} to your wallet.`)
        notifyAdmin(`❌ Fax number registration rejected: ${n.phoneNumber} (account ${n.chatId}) — refunded $${n.price}`)
      }
    }
  }

  // Renews due numbers from the wallet; unpaid ones pause (no faxes) for 3 days, then are released.
  async function renewDue(now = new Date()) {
    for (const n of await nums.find({ status: { $in: ['active', 'past_due'] }, expiresAt: { $lte: now.toISOString() } }).limit(200).toArray()) {
      if (n.autoRenew === false) { await release(n, 'cancelled'); continue }
      if (await w.debit(n.chatId, n.price)) {
        await nums.updateOne({ _id: n._id }, { $set: { status: 'active', expiresAt: nextMonth(n.expiresAt > now.toISOString() ? n.expiresAt : now) }, $unset: { pastDueAt: '' } })
        await db.collection('transactions').insertOne({ chatId: n.chatId, type: 'fax-number-renewal', amount: n.price, currency: 'USD', status: 'completed', metadata: { phoneNumber: n.phoneNumber, channel: 'web' }, createdAt: new Date(), updatedAt: new Date() }).catch(() => {})
        if (n.status === 'past_due') await push(n.chatId, `Fax number ${n.phoneNumber} is renewed and receiving faxes again.`)
        continue
      }
      if (n.status === 'active') {
        await nums.updateOne({ _id: n._id }, { $set: { status: 'past_due', pastDueAt: now } })
        await push(n.chatId, `Fax number ${n.phoneNumber} could not renew: your wallet doesn't cover $${n.price.toFixed(2)}. Top up within 3 days to keep it — it is paused until then.`)
        notifyAdmin(`📠 Fax number ${n.phoneNumber} (web ${n.chatId}) past due — $${n.price}`)
      } else if (now - new Date(n.pastDueAt) >= GRACE_MS) await release(n, 'unpaid')
    }
  }
  if (sweep) require('./active-slot').singletonInterval('fax-numbers', () => renewDue().then(checkRegistrations).then(() => chaseDetails()).catch(e => log(`[FaxNumbers] renewal sweep failed: ${e.message}`)), 30 * 60000)

  return { offer, search, buy, list, setAutoRenew, renewDue, checkRegistrations, submitDetails, cancelPending, chaseDetails, cache: cache2, FaxNumberError }
}

module.exports = { create, FaxNumberError, COUNTRIES, offerOf, paperworkIssue, PRICE, selling: acct.enabled }
