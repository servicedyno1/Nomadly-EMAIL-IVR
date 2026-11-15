'use strict'
// Fax-only numbers (MultiTEL; web + bots): search, buy from the wallet, monthly renewal, release. Countries needing no ID or
// just a name + address; those needing registration wait for the carrier and are refunded in full if rejected.
// They sit on the Fax Application, so they send and receive faxes only — no calls, no texts, no SIP.
const crypto = require('crypto')
const telnyxAcct = require('./telnyx-fax-account')
const swFax = require('./signalwire/fax')
const mtFax = require('./multitel/fax')
// New fax numbers come from MultiTEL only; numbers bought earlier on SignalWire / Telnyx stay where they are.
const acct = { enabled: () => mtFax.enabled(), searchFax: (...a) => mtFax.searchFax(...a) }
const releaseFor = (n) => (n.provider === 'multitel_fax' ? mtFax.releaseFax(n.phoneNumber) : n.provider === 'signalwire_fax' ? swFax.releaseFax(n.phoneNumber) : telnyxAcct.releaseFax(n.phoneNumber))
const fax = require('./fax-service')
const { walletOps, round2 } = require('./cloudivr-web/wallet')

const PRICE = () => round2(Number(process.env.FAX_NUMBER_PRICE) || 50)
// Fax (T.38) offers from the 15 Nov 2026 MultiTEL scan (memory/MULTITEL_FAX_COUNTRIES_2026-11-15.md), paperwork level 0–1 only.
const FAX_TYPES = { US: ['local'], CA: ['local'], GB: ['local', 'national', 'mobile'], NL: ['local', 'national', 'mobile'], IE: ['local', 'national'], AR: ['local'], SV: ['local'], IS: ['local'], VN: ['local'], DK: ['national'], LT: ['local'], AU: ['local'], GR: ['local'], NZ: ['local'], EE: ['national'] }
const TYPE_LABEL = { local: 'Local', national: 'National', mobile: 'Mobile' }
const { NAMES, offer: mtOffer } = require('./multitel/countries')
const offerOf = (cc, type) => { const o = FAX_TYPES[cc]?.includes(type) ? mtOffer(cc, type) : null; return o && o.level <= 1 ? o : null }
const COUNTRIES = Object.keys(FAX_TYPES).map(code => ({ code, name: NAMES[code] || code, areaCodes: ['US', 'CA'].includes(code),
  types: FAX_TYPES[code].filter(t => offerOf(code, t)).map(t => { const o = offerOf(code, t); return { type: t, label: TYPE_LABEL[t], paperwork: o.level ? 'name_address' : 'none', businessOnly: o.businessOnly, address: o.address } }) }))
  .sort((a, b) => (a.code === 'US' ? -1 : b.code === 'US' ? 1 : a.name.localeCompare(b.name)))
// Saved name + address vs the offer's rules → message, or null when it can buy.
function paperworkIssue(cc, type, eu) {
  const o = offerOf(cc, type), name = NAMES[cc] || cc
  if (!o?.level) return null
  if (!eu?.name || !eu?.address) return `${name} fax numbers need your name and address.`
  if (o.businessOnly && eu.type !== 'business') return `${name} fax numbers are sold to businesses only.`
  if (o.address !== 'any' && eu.countryCode && eu.countryCode !== cc) return `${name} fax numbers need an address in ${name}.`
  return null
}
const GRACE_MS = 3 * 86400000
const dry = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const nextMonth = (from = new Date()) => { const d = new Date(from); d.setMonth(d.getMonth() + 1); return d.toISOString() }

class FaxNumberError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code } }

function create(db, { log = console.log, notifyAdmin = () => {}, push = () => {}, sweep = true } = {}) {
  const nums = db.collection('faxNumbers'), cache = db.collection('faxNumberSearch'), locks = db.collection('webNumberLocks'), seen = db.collection('faxNumberSeen')
  seen.createIndex({ at: 1 }, { expireAfterSeconds: 2 * 3600 }).catch(() => {})
  const w = walletOps(db)
  nums.createIndex({ chatId: 1 }).catch(() => {})

  const pub = (n) => ({ phoneNumber: n.phoneNumber, country: n.country, type: n.type || 'local', status: n.status, price: n.price, autoRenew: n.autoRenew !== false, expiresAt: n.expiresAt, createdAt: n.createdAt, faxOnly: true, capabilities: { voice: false, sms: false, fax: true } })
  const list = async (chatId) => (await nums.find({ chatId: String(chatId), status: { $ne: 'released' } }).sort({ createdAt: -1 }).toArray()).map(pub)
  const offer = () => ({ available: acct.enabled(), price: PRICE(), countries: COUNTRIES, freePages: fax.FREE_PAGES, pagePrice: fax.PAGE_PRICE })
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

  async function buy(chatId, { phoneNumber, autoRenew = true, email = '', endUser = null }) {
    chatId = String(chatId)
    let c = await cache.findOne({ _id: chatId })
    let hit = c?.results?.find(r => r.phoneNumber === phoneNumber)
    if (!hit) { const v = await seen.findOne({ _id: phoneNumber }); if (v) { c = { country: v.country, type: v.type }; hit = { phoneNumber } } }
    if (!hit) throw new FaxNumberError(400, 'search_again', 'That number is no longer in your search results. Search again and pick a number.')
    const type = c.type || 'local', o = offerOf(c.country, type)
    const why = paperworkIssue(c.country, type, endUser)
    if (why) throw new FaxNumberError(400, 'paperwork_needed', why)
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
        else { const o = await mtFax.orderFax(phoneNumber); orderId = o?.id; real = o?.phoneNumber || phoneNumber; if (o?.needsReg) needsReg = true }
        if (!orderId) throw new Error('no order id')
      } catch (e) {
        await w.credit(chatId, price)
        log(`[FaxNumbers] order ${phoneNumber} for ${chatId} failed: ${e.response?.data?.errors?.[0]?.detail || e.response?.data?.message || e.message} — refunded $${price}`)
        throw new FaxNumberError(424, 'purchase_failed', `This fax number could not be activated. You were refunded $${price.toFixed(2)}. Pick another number.`)
      }
      const doc = { _id: real, phoneNumber: real, chatId, country: c.country, type, status: needsReg ? 'pending_registration' : 'active', faxOnly: true, plan: 'fax', price, autoRenew: autoRenew !== false, provider: 'multitel_fax', mtNumberId: orderId, expiresAt: nextMonth(), createdAt: new Date(), ...(endUser ? { endUser } : {}), ...(needsReg ? { registration: { status: 'pending', since: new Date() } } : {}), ...(dry() ? { dryRun: true } : {}) }
      await nums.replaceOne({ _id: real }, doc, { upsert: true })
      if (needsReg) await sendRegistration(doc, email)
      await db.collection('transactions').insertOne({ chatId, type: 'fax-number', amount: price, currency: 'USD', status: 'completed', metadata: { phoneNumber: real, provider: 'multitel_fax' }, createdAt: new Date(), updatedAt: new Date() }).catch(() => {})
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
  async function sendRegistration(n, email) {
    if (n.dryRun) return
    const eu = n.endUser || {}, from = process.env.CLOUDIVR_MAIL_SENDER || process.env.MAIL_SENDER
    const html = `<p>Hello MultiTEL team,</p><p>Please register this fax number for its end user.</p><ul><li>Number: <b>${n.phoneNumber}</b> (${NAMES[n.country] || n.country} ${n.type})</li><li>End user type: ${eu.type || '-'}</li><li>Name: ${eu.name || '-'}</li>${eu.contact ? `<li>Contact person: ${eu.contact}</li>` : ''}<li>Address: ${eu.address || '-'}</li>${email ? `<li>Contact email: ${email}</li>` : ''}</ul><p>Thank you</p>`
    const sent = await require('./mailer').send({ from: { name: process.env.MAIL_SENDER_NAME || 'CloudIVR', email: from }, to: process.env.MULTITEL_DOCS_EMAIL || 'support@multitel.net', subject: `DID registration: ${n.phoneNumber} (${NAMES[n.country] || n.country})`, html }).then(() => true, e => { log(`[FaxNumbers] registration email ${n.phoneNumber}: ${e.message}`); return false })
    await nums.updateOne({ _id: n._id }, { $set: { 'registration.sent': sent, 'registration.sentAt': new Date() } })
    notifyAdmin(`📄 Fax number registration ${sent ? 'sent to MultiTEL' : 'NOT sent (email failed)'}: ${n.phoneNumber} (${n.country}) — account ${n.chatId}`)
  }

  // Waiting registrations: approved → live (the month starts now); rejected → released + full refund.
  async function checkRegistrations() {
    const mt = require('./multitel')
    for (const n of await nums.find({ status: 'pending_registration', dryRun: { $ne: true } }).limit(50).toArray()) {
      const st = await mt.registrationStatus(n.phoneNumber).catch(() => ({ state: 'pending' }))
      if (st.state === 'active') {
        await nums.updateOne({ _id: n._id, status: 'pending_registration' }, { $set: { status: 'active', expiresAt: nextMonth(), 'registration.status': 'approved', 'registration.decidedAt': new Date() } })
        await push(n.chatId, `Your fax number ${n.phoneNumber} was approved by the carrier and can send and receive faxes now.`)
      } else if (st.state === 'rejected') {
        const u = await nums.updateOne({ _id: n._id, status: 'pending_registration' }, { $set: { status: 'released', releasedAt: new Date(), releaseReason: 'registration_rejected', 'registration.status': 'rejected', 'registration.raw': st.raw } })
        if (!u.modifiedCount) continue
        await mtFax.releaseFax(n.phoneNumber).catch(() => {})
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
  if (sweep) require('./active-slot').singletonInterval('fax-numbers', () => renewDue().then(checkRegistrations).catch(e => log(`[FaxNumbers] renewal sweep failed: ${e.message}`)), 30 * 60000)

  return { offer, search, buy, list, setAutoRenew, renewDue, checkRegistrations, cache: cache2, FaxNumberError }
}

module.exports = { create, FaxNumberError, COUNTRIES, offerOf, paperworkIssue, PRICE }
