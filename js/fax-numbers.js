'use strict'
// Fax-only numbers for CloudIVR web (USA/Canada, MultiTEL): search, buy from the wallet, monthly renewal, release.
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

const PRICE = () => round2(Number(process.env.FAX_NUMBER_PRICE) || 9)
const COUNTRIES = [{ code: 'US', name: 'United States' }, { code: 'CA', name: 'Canada' }]
const GRACE_MS = 3 * 86400000
const dry = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const nextMonth = (from = new Date()) => { const d = new Date(from); d.setMonth(d.getMonth() + 1); return d.toISOString() }

class FaxNumberError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code } }

function create(db, { log = console.log, notifyAdmin = () => {}, push = () => {}, sweep = true } = {}) {
  const nums = db.collection('faxNumbers'), cache = db.collection('faxNumberSearch'), locks = db.collection('webNumberLocks'), seen = db.collection('faxNumberSeen')
  seen.createIndex({ at: 1 }, { expireAfterSeconds: 2 * 3600 }).catch(() => {})
  const w = walletOps(db)
  nums.createIndex({ chatId: 1 }).catch(() => {})

  const pub = (n) => ({ phoneNumber: n.phoneNumber, country: n.country, status: n.status, price: n.price, autoRenew: n.autoRenew !== false, expiresAt: n.expiresAt, createdAt: n.createdAt, faxOnly: true, capabilities: { voice: false, sms: false, fax: true } })
  const list = async (chatId) => (await nums.find({ chatId: String(chatId), status: { $ne: 'released' } }).sort({ createdAt: -1 }).toArray()).map(pub)
  const offer = () => ({ available: acct.enabled(), price: PRICE(), countries: COUNTRIES, freePages: fax.FREE_PAGES, pagePrice: fax.PAGE_PRICE })

  async function search(chatId, country, areaCode) {
    if (!acct.enabled()) throw new FaxNumberError(503, 'unavailable', 'Fax numbers are not available right now. Please try again later.')
    const cc = String(country || 'US').toUpperCase()
    if (!COUNTRIES.some(c => c.code === cc)) throw new FaxNumberError(400, 'invalid_country', 'Fax numbers are sold in the USA and Canada.')
    const ac = /^\d{3}$/.test(String(areaCode || '')) ? String(areaCode) : null
    let found
    try { found = await acct.searchFax(cc, ac) } catch (e) {
      log(`[FaxNumbers] search ${cc}${ac ? ` ${ac}` : ''} failed: ${e.response?.data?.errors?.[0]?.detail || e.message}`)
      throw new FaxNumberError(503, 'unavailable', 'Fax numbers could not be searched right now. Please try again in a minute.')
    }
    const held = new Set((await nums.find({ _id: { $in: found.map(n => n.phoneNumber) }, status: { $ne: 'released' } }, { projection: { _id: 1 } }).toArray()).map(d => d._id))
    const results = found.filter(n => !held.has(n.phoneNumber)).map(({ phoneNumber, region, nearby }) => ({ phoneNumber, region, nearby, capabilities: { voice: false, sms: false, fax: true } }))
    // Visitor searches (no account yet) are remembered per number for 2 hours, so the pick survives sign-up.
    if (chatId) await cache.updateOne({ _id: String(chatId) }, { $set: { country: cc, results, at: new Date() } }, { upsert: true })
    else if (results.length) await seen.bulkWrite(results.map(r => ({ updateOne: { filter: { _id: r.phoneNumber }, update: { $set: { country: cc, region: r.region, at: new Date() } }, upsert: true } }))).catch(() => {})
    return { numbers: results, price: PRICE(), areaCode: ac, nearbyOnly: !!ac && results.length > 0 && results.every(n => n.nearby) }
  }

  async function buy(chatId, { phoneNumber, autoRenew = true, email = '' }) {
    chatId = String(chatId)
    let c = await cache.findOne({ _id: chatId })
    let hit = c?.results?.find(r => r.phoneNumber === phoneNumber)
    if (!hit) { const v = await seen.findOne({ _id: phoneNumber }); if (v) { c = { country: v.country }; hit = { phoneNumber } } }
    if (!hit) throw new FaxNumberError(400, 'search_again', 'That number is no longer in your search results. Search again and pick a number.')
    try { await locks.insertOne({ _id: phoneNumber, chatId, at: new Date() }) } catch (e) {
      if (e.code === 11000) throw new FaxNumberError(409, 'number_taken', 'Someone is buying that number right now. Pick another one.')
      throw e
    }
    const price = PRICE()
    try {
      if (await nums.findOne({ _id: phoneNumber, status: { $ne: 'released' } })) throw new FaxNumberError(409, 'number_taken', 'Someone just took that number. Pick another one.')
      if (!(await w.debit(chatId, price))) throw new FaxNumberError(402, 'insufficient_balance', `This fax number costs $${price.toFixed(2)}/month. Your wallet has $${(await w.balance(chatId)).toFixed(2)} — top up first.`)
      let orderId
      try {
        if (dry()) orderId = `dryrun-${crypto.randomUUID().slice(0, 8)}`
        else orderId = (await mtFax.orderFax(phoneNumber))?.id
        if (!orderId) throw new Error('no order id')
      } catch (e) {
        await w.credit(chatId, price)
        log(`[FaxNumbers] order ${phoneNumber} for ${chatId} failed: ${e.response?.data?.errors?.[0]?.detail || e.response?.data?.message || e.message} — refunded $${price}`)
        throw new FaxNumberError(424, 'purchase_failed', `This fax number could not be activated. You were refunded $${price.toFixed(2)}. Pick another number.`)
      }
      const doc = { _id: phoneNumber, phoneNumber, chatId, country: c.country, status: 'active', faxOnly: true, plan: 'fax', price, autoRenew: autoRenew !== false, provider: 'multitel_fax', mtNumberId: orderId, expiresAt: nextMonth(), createdAt: new Date(), ...(dry() ? { dryRun: true } : {}) }
      await nums.replaceOne({ _id: phoneNumber }, doc, { upsert: true })
      await db.collection('transactions').insertOne({ chatId, type: 'fax-number', amount: price, currency: 'USD', status: 'completed', metadata: { phoneNumber, channel: 'web', provider: 'multitel_fax' }, createdAt: new Date(), updatedAt: new Date() }).catch(() => {})
      await cache.deleteOne({ _id: chatId }); await seen.deleteOne({ _id: phoneNumber }).catch(() => {})
      notifyAdmin(`📠 CloudIVR web fax number${dry() ? ' (DRY RUN)' : ''}\nweb account: ${chatId}${email ? ` (${email})` : ''}\nnumber: ${phoneNumber} (${c.country}) · $${price}/month`)
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
  if (sweep) setInterval(() => renewDue().catch(e => log(`[FaxNumbers] renewal sweep failed: ${e.message}`)), 30 * 60000).unref?.()

  return { offer, search, buy, list, setAutoRenew, renewDue, FaxNumberError }
}

module.exports = { create, FaxNumberError, COUNTRIES }
