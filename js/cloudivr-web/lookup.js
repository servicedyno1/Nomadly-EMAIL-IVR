'use strict'
// Number + email lookups (Bird). Priced at 3x Bird's fee, paid from the wallet per lookup and refunded when Bird
// can't answer. One at a time or up to 1,000 per bulk run. History in `numberLookups` / `emailLookups`.
const BIRD_COST = 0.005
const BIRD_EMAIL_COST = 0.0005
const PRICE = Math.round(Number(process.env.LOOKUP_PRICE || BIRD_COST * 3) * 1000) / 1000
// Caller name (CNAM) add-on: run and charged for every US/Canada number checked; never run elsewhere.
const CNAM_PRICE = Math.round(Number(process.env.CNAM_LOOKUP_PRICE || 0.02) * 1000) / 1000
const NANP = /^\+1\d{10}$/
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
  const charge = (chatId, type, amount, ref) => tx.insertOne({ _id: `${type}-${chatId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, chatId: String(chatId), type, amount: round4(amount), currency: 'USD', status: 'completed', ref, metadata: { phoneNumber: ref }, createdAt: new Date() })
  const numRow = (chatId, number, out, batchId) => ({ chatId, number, valid: out.valid, country: out.country, carrier: out.carrier, type: out.type, ported: !!out.ported, ...(out.callerName !== undefined ? { callerName: out.callerName || null } : {}), price: round4(PRICE + (out.callerName !== undefined ? CNAM_PRICE : 0)), ...(batchId ? { batchId } : {}), at: new Date() })
  const mailRow = (chatId, email, out, batchId) => ({ chatId, email, result: out.result, valid: !!out.valid, confidence: out.confidence, flags: out.flags || [], price: EMAIL_PRICE, ...(batchId ? { batchId } : {}), at: new Date() })
  // List from a paste or CSV text: split on commas, spaces, semicolons and new lines; dedupe.
  const listOf = (raw, isOk, clean) => {
    const all = (Array.isArray(raw) ? raw : String(raw || '').split(/[\s,;]+/)).map(x => String(x).trim()).filter(Boolean)
    const valid = all.map(clean).filter(isOk)
    const good = [...new Set(valid)]
    return { good, skipped: all.length - valid.length, duplicates: valid.length - good.length }
  }

  // Charge for the whole list first, run it, refund the ones Bird couldn't answer.
  // Up to SYNC_MAX items answer right away; bigger runs continue in the background and are polled by batchId.
  const SYNC_MAX = 100
  const batches = db.collection('lookupBatches')
  const pub = (rows, good, key) => good.map((x, k) => (rows[k] ? strip(rows[k]) : { [key]: x, failed: true }))
  async function bulk(req, res, { raw, isOk, clean, price, run, runMany, row, store, type, noun, nameBack = 0 }) {
    const { good, skipped, duplicates } = listOf(raw, isOk, clean)
    if (!good.length) return bad(res, 400, 'nothing_to_check', `Paste or upload at least one ${noun}.`)
    if (good.length > MAX_BULK) return bad(res, 400, 'too_many', `Up to ${MAX_BULK} ${noun}s per run — you sent ${good.length}.`)
    const total = round4(good.length * price)
    if (!(await w.debit(req.webChatId, total))) return bad(res, 402, 'insufficient_balance', `Checking ${good.length} ${noun}s costs $${total.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}. Top up your wallet first.`)
    const chatId = req.webChatId, batchId = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, key = noun === 'email' ? 'email' : 'number'
    await batches.insertOne({ _id: batchId, chatId, kind: key, total: good.length, done: 0, status: 'running', skipped, duplicates, price, at: new Date() })
    const work = (async () => {
      let n = 0
      const outs = runMany ? await runMany(good) : await pool(good, 1, async (x) => { const o = await run(x); if (++n % 5 === 0) batches.updateOne({ _id: batchId }, { $set: { done: n } }).catch(() => {}); return o })
      const rows = good.map((x, k) => (outs[k] ? row(chatId, x, outs[k], batchId) : null))
      const ok = rows.filter(Boolean), failed = good.length - ok.length
      // Claim the batch first: if the stuck-sweep already refunded it in full, don't refund or charge again.
      if (!(await batches.updateOne({ _id: batchId, status: 'running' }, { $set: { status: 'finishing' } })).modifiedCount) { log(`[Lookup] bulk ${batchId} finished after it was refunded — results dropped`); return null }
      const noName = nameBack ? ok.filter(x => x.callerName === undefined).length : 0 // caller name not run (outside US/Canada)
      const back = round4(failed * price + noName * nameBack), spent = round4(ok.length * price - noName * nameBack)
      if (back) await w.credit(chatId, back)
      if (ok.length) { await store.insertMany(ok); await charge(chatId, type, spent, `${ok.length} ${noun}${ok.length === 1 ? '' : 's'}`) }
      const result = { results: pub(rows, good, key), charged: spent, refunded: back, skipped, duplicates }
      await batches.updateOne({ _id: batchId }, { $set: { status: 'done', done: good.length, charged: result.charged, refunded: result.refunded, failedItems: good.filter((_, k) => !rows[k]) } })
      log(`[Lookup] ${chatId} bulk ${type}: ${ok.length} done, ${failed} refunded, ${skipped} skipped, ${duplicates} duplicates`)
      return result
    })().catch(async (e) => { log(`[Lookup] bulk ${batchId} failed: ${e.message}`); await batches.updateOne({ _id: batchId }, { $set: { status: 'failed' } }).catch(() => {}); return null })
    if (good.length > (runMany ? SYNC_MAX : 3)) return res.status(202).json({ batchId, status: 'running', total: good.length, done: 0, skipped, duplicates, etaSeconds: runMany ? 15 : Math.ceil(good.length * 6.5) })
    const r = await work
    if (!r) return bad(res, 500, 'bulk_failed', 'Something went wrong during the check. Unchecked items were not charged.')
    res.json({ batchId, status: 'done', ...r })
  }

  // A run cut short by a restart never finishes: refund it in full (nothing was stored for it).
  // Stuck = older than twice its expected run time (min 10 min), e.g. cut short by a restart.
  const priceOf = (b) => b.price ?? (b.kind === 'email' ? EMAIL_PRICE : PRICE)
  const stuck = (b) => Date.now() - new Date(b.at).getTime() > Math.max(10 * 60000, (b.kind === 'email' ? 30 : 13) * 1000 * (b.total || 1))
  async function sweep() {
    for (const b of (await batches.find({ status: 'running', at: { $lt: new Date(Date.now() - 10 * 60000) } }).toArray()).filter(stuck)) {
      const p = priceOf(b), r = await batches.updateOne({ _id: b._id, status: 'running' }, { $set: { status: 'failed', refunded: round4(b.total * p) } })
      if (r.modifiedCount && p) { await w.credit(b.chatId, round4(b.total * p)); log(`[Lookup] refunded interrupted bulk ${b._id} ($${round4(b.total * p)})`) }
    }
  }
  setTimeout(() => sweep().catch(() => {}), 60000)
  setInterval(() => sweep().catch(() => {}), 30 * 60000).unref?.()

  async function batchView(req, res) {
    const b = await batches.findOne({ _id: String(req.params.id), chatId: req.webChatId })
    if (!b) return bad(res, 404, 'not_found', 'That check was not found.')
    if (b.status === 'running' && stuck(b)) { await sweep(); return batchView(req, res) }
    if (b.status === 'failed') return bad(res, 410, 'check_failed', `This check didn’t finish. You were refunded $${round4(b.refunded || b.total * priceOf(b))}. Run it again.`)
    if (b.status !== 'done') return res.json({ batchId: b._id, status: b.status === 'finishing' ? 'running' : b.status, total: b.total, done: b.done, skipped: b.skipped, duplicates: b.duplicates, etaSeconds: b.kind === 'email' ? 15 : Math.ceil((b.total - (b.done || 0)) * 6.5) })
    const store = b.kind === 'email' ? ecol : col
    const rows = (await store.find({ chatId: req.webChatId, batchId: b._id }).toArray()).map(strip)
    res.json({ batchId: b._id, status: 'done', total: b.total, done: b.total, results: [...rows, ...(b.failedItems || []).map(x => ({ [b.kind]: x, failed: true }))], charged: b.charged, refunded: b.refunded, skipped: b.skipped, duplicates: b.duplicates })
  }

  const numberOf = (n) => bird.lookup(n)
  const cnamOf = (n) => require('../cnam-service').lookupCnam(n).then(x => (x && String(x).trim()) || null).catch(() => null)
  // Number lookup + (asked, US/Canada) caller name; callerName: string | null when asked, undefined when not.
  const withName = async (n, out, want) => (out && want && NANP.test(n) ? { ...out, callerName: await cnamOf(n) } : out)
  const emailOf = (e) => bird.lookupEmail(e)

  function routes(r) {
    r.get('/lookup', h(async (req, res) => res.json({
      price: PRICE, cnamPrice: CNAM_PRICE, emailPrice: EMAIL_PRICE, maxBulk: MAX_BULK,
      history: (await col.find({ chatId: req.webChatId }).sort({ at: -1 }).limit(20).toArray()).map(strip),
      batches: (await batches.find({ chatId: req.webChatId }).sort({ at: -1 }).limit(5).toArray()).map(b => ({ batchId: b._id, kind: b.kind, total: b.total, done: b.done, status: b.status, at: b.at })),
      emailHistory: (await ecol.find({ chatId: req.webChatId }).sort({ at: -1 }).limit(20).toArray()).map(strip),
    })))
    r.post('/lookup', h(async (req, res) => {
      const number = cleanNum(req.body?.number)
      if (!E164.test(number)) return bad(res, 400, 'invalid_number', 'Enter the full number with country code, e.g. +44 20 7946 0958.')
      const want = req.body?.callerName === true && NANP.test(number), hold = round4(PRICE + (want ? CNAM_PRICE : 0))
      if (!(await w.debit(req.webChatId, hold))) return bad(res, 402, 'insufficient_balance', `A lookup costs $${hold}. Top up your wallet first.`)
      const out = await withName(number, await numberOf(number).catch(() => null), want)
      if (!out) { await w.credit(req.webChatId, hold); return bad(res, 503, 'lookup_unavailable', 'The lookup service didn’t answer. You weren’t charged. Try again in a minute.') }
      const row = numRow(req.webChatId, number, out)
      await col.insertOne(row)
      await charge(req.webChatId, 'number-lookup', row.price, row.number)
      res.json(strip(row))
    }))
    r.get('/lookup/batches/:id', h(batchView))
    r.post('/lookup/bulk', h(async (req, res) => {
      const want = req.body?.callerName === true
      // With caller names the price held per number includes the name; the name part is given back for non-US/Canada numbers.
      bulk(req, res, { raw: req.body?.numbers, isOk: (n) => E164.test(n), clean: cleanNum, price: want ? round4(PRICE + CNAM_PRICE) : PRICE, run: async (n) => withName(n, await bird.lookup(n, { bulk: true }), want), row: numRow, store: col, type: 'number-lookup', noun: 'number', nameBack: want ? CNAM_PRICE : 0 })
    }))
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
    r.post('/lookup/email/bulk', h(async (req, res) => bulk(req, res, { raw: req.body?.emails, isOk: (e) => EMAIL.test(e), clean: (e) => String(e).trim().toLowerCase(), price: EMAIL_PRICE, run: emailOf, runMany: (list) => bird.lookupEmails(list), row: mailRow, store: ecol, type: 'email-check', noun: 'email' })))
  }
  return { routes, PRICE, EMAIL_PRICE }
}

module.exports = { createLookup, PRICE, EMAIL_PRICE, pool }
