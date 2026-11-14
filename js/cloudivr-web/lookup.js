'use strict'
// Number + email lookups (Bird). Priced at 3x Bird's fee, paid from the wallet per lookup and refunded when Bird
// can't answer. One at a time or up to 1,000 per bulk run. History in `numberLookups` / `emailLookups`.
const BIRD_COST = 0.005
const BIRD_EMAIL_COST = 0.0005
const PRICE = Math.round(Number(process.env.LOOKUP_PRICE || BIRD_COST * 3) * 1000) / 1000
const EMAIL_PRICE = Math.round(Number(process.env.EMAIL_LOOKUP_PRICE || BIRD_EMAIL_COST * 3) * 10000) / 10000
const E164 = /^\+?[1-9]\d{6,14}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MAX_BULK = 1000
const round4 = (n) => Math.round(n * 10000) / 10000
const cleanNum = (x) => { const n = String(x || '').replace(/[\s().-]/g, ''); return n.startsWith('+') ? n : `+${n}` }

// Runs fn over items, `n` at a time, keeping order.
async function pool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null) } }))
  return out
}

function createLookup({ db, h, walletOps, bird = require('../bird'), log = console.log }) {
  const w = walletOps(db), col = db.collection('numberLookups'), ecol = db.collection('emailLookups')
  const tx = db.collection('transactions')
  const bad = (res, s, error, message) => res.status(s).json({ error, message })
  const strip = ({ _id, chatId, ...x }) => x
  const charge = (chatId, type, amount, ref) => tx.insertOne({ _id: `${type}-${chatId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, chatId: String(chatId), type, amount: round4(amount), currency: 'USD', status: 'completed', ref, createdAt: new Date() })
  const numRow = (chatId, number, out, batchId) => ({ chatId, number, valid: out.valid, country: out.country, carrier: out.carrier, type: out.type, ported: !!out.ported, price: PRICE, ...(batchId ? { batchId } : {}), at: new Date() })
  const mailRow = (chatId, email, out, batchId) => ({ chatId, email, result: out.result, valid: !!out.valid, confidence: out.confidence, flags: out.flags || [], price: EMAIL_PRICE, ...(batchId ? { batchId } : {}), at: new Date() })
  // List from a paste or CSV text: split on commas, spaces, semicolons and new lines; dedupe.
  const listOf = (raw, isOk, clean) => {
    const all = (Array.isArray(raw) ? raw : String(raw || '').split(/[\s,;]+/)).map(x => String(x).trim()).filter(Boolean)
    const good = [...new Set(all.map(clean).filter(isOk))]
    return { good, skipped: all.length - good.length }
  }

  // Charge for the whole list first, run it, refund the ones Bird couldn't answer.
  async function bulk(req, res, { raw, isOk, clean, price, run, row, store, type, noun }) {
    const { good, skipped } = listOf(raw, isOk, clean)
    if (!good.length) return bad(res, 400, 'nothing_to_check', `Paste or upload at least one ${noun}.`)
    if (good.length > MAX_BULK) return bad(res, 400, 'too_many', `Up to ${MAX_BULK} ${noun}s per run — you sent ${good.length}.`)
    const total = round4(good.length * price)
    if (!(await w.debit(req.webChatId, total))) return bad(res, 402, 'insufficient_balance', `Checking ${good.length} ${noun}s costs $${total.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}. Top up your wallet first.`)
    const batchId = `b${Date.now().toString(36)}`
    const outs = await pool(good, 10, run)
    const rows = good.map((x, k) => (outs[k] ? row(req.webChatId, x, outs[k], batchId) : null))
    const done = rows.filter(Boolean)
    const failed = good.length - done.length
    if (failed) await w.credit(req.webChatId, round4(failed * price))
    if (done.length) { await store.insertMany(done); await charge(req.webChatId, type, done.length * price, `bulk ${done.length}`) }
    log(`[Lookup] ${req.webChatId} bulk ${type}: ${done.length} done, ${failed} refunded, ${skipped} skipped`)
    res.json({ batchId, results: good.map((x, k) => (rows[k] ? strip(rows[k]) : { [noun === 'email' ? 'email' : 'number']: x, failed: true })), charged: round4(done.length * price), refunded: round4(failed * price), skipped })
  }

  const numberOf = (n) => bird.lookup(n)
  const emailOf = (e) => bird.lookupEmail(e)

  function routes(r) {
    r.get('/lookup', h(async (req, res) => res.json({
      price: PRICE, emailPrice: EMAIL_PRICE, maxBulk: MAX_BULK,
      history: (await col.find({ chatId: req.webChatId }).sort({ at: -1 }).limit(20).toArray()).map(strip),
      emailHistory: (await ecol.find({ chatId: req.webChatId }).sort({ at: -1 }).limit(20).toArray()).map(strip),
    })))
    r.post('/lookup', h(async (req, res) => {
      const number = cleanNum(req.body?.number)
      if (!E164.test(number)) return bad(res, 400, 'invalid_number', 'Enter the full number with country code, e.g. +44 20 7946 0958.')
      if (!(await w.debit(req.webChatId, PRICE))) return bad(res, 402, 'insufficient_balance', `A lookup costs $${PRICE}. Top up your wallet first.`)
      const out = await numberOf(number).catch(() => null)
      if (!out) { await w.credit(req.webChatId, PRICE); return bad(res, 503, 'lookup_unavailable', 'The lookup service didn’t answer. You weren’t charged. Try again in a minute.') }
      const row = numRow(req.webChatId, number, out)
      await col.insertOne(row)
      await charge(req.webChatId, 'number-lookup', PRICE, row.number)
      res.json(strip(row))
    }))
    r.post('/lookup/bulk', h(async (req, res) => bulk(req, res, { raw: req.body?.numbers, isOk: (n) => E164.test(n), clean: cleanNum, price: PRICE, run: numberOf, row: numRow, store: col, type: 'number-lookup', noun: 'number' })))
    r.post('/lookup/email', h(async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase()
      if (!EMAIL.test(email)) return bad(res, 400, 'invalid_email', 'Enter a full email address, e.g. name@example.com.')
      if (!(await w.debit(req.webChatId, EMAIL_PRICE))) return bad(res, 402, 'insufficient_balance', `An email check costs $${EMAIL_PRICE}. Top up your wallet first.`)
      const out = await emailOf(email).catch(() => null)
      if (!out) { await w.credit(req.webChatId, EMAIL_PRICE); return bad(res, 503, 'lookup_unavailable', 'The email check didn’t answer. You weren’t charged. Try again in a minute.') }
      const row = mailRow(req.webChatId, email, out)
      await ecol.insertOne(row)
      await charge(req.webChatId, 'email-check', EMAIL_PRICE, email)
      res.json(strip(row))
    }))
    r.post('/lookup/email/bulk', h(async (req, res) => bulk(req, res, { raw: req.body?.emails, isOk: (e) => EMAIL.test(e), clean: (e) => String(e).trim().toLowerCase(), price: EMAIL_PRICE, run: emailOf, row: mailRow, store: ecol, type: 'email-check', noun: 'email' })))
  }
  return { routes, PRICE, EMAIL_PRICE }
}

module.exports = { createLookup, PRICE, EMAIL_PRICE, pool }
