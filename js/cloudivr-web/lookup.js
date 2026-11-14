'use strict'
// Number lookups (Bird): country, carrier, line type and porting for any number. Priced at 3x Bird's base lookup fee,
// paid from the wallet per lookup and refunded when Bird can't answer. History in `numberLookups`.
const BIRD_COST = 0.005
const PRICE = Math.round(Number(process.env.LOOKUP_PRICE || BIRD_COST * 3) * 1000) / 1000
const E164 = /^\+?[1-9]\d{6,14}$/

function createLookup({ db, h, walletOps, bird = require('../bird'), log = console.log }) {
  const w = walletOps(db), col = db.collection('numberLookups')
  const bad = (res, s, error, message) => res.status(s).json({ error, message })
  function routes(r) {
    r.get('/lookup', h(async (req, res) => res.json({ price: PRICE, history: (await col.find({ chatId: req.webChatId }).sort({ at: -1 }).limit(20).toArray()).map(({ _id, chatId, ...x }) => x) })))
    r.post('/lookup', h(async (req, res) => {
      const number = String(req.body?.number || '').replace(/[\s().-]/g, '')
      if (!E164.test(number)) return bad(res, 400, 'invalid_number', 'Enter the full number with country code, e.g. +44 20 7946 0958.')
      if (!(await w.debit(req.webChatId, PRICE))) return bad(res, 402, 'insufficient_balance', `A lookup costs $${PRICE}. Top up your wallet first.`)
      const out = await bird.lookup(number).catch(() => null)
      if (!out) { await w.credit(req.webChatId, PRICE); return bad(res, 503, 'lookup_unavailable', 'The lookup service didn’t answer. You weren’t charged. Try again in a minute.') }
      const row = { chatId: req.webChatId, number: number.startsWith('+') ? number : `+${number}`, valid: out.valid, country: out.country, carrier: out.carrier, type: out.type, ported: !!out.ported, price: PRICE, at: new Date() }
      await col.insertOne(row)
      await db.collection('transactions').insertOne({ _id: `lookup-${req.webChatId}-${Date.now()}`, chatId: String(req.webChatId), type: 'number-lookup', amount: PRICE, currency: 'USD', status: 'completed', ref: row.number, createdAt: new Date() })
      log(`[Lookup] ${req.webChatId} looked up ${row.number}: ${row.type}/${row.carrier}`)
      const { _id, chatId, ...pub } = row
      res.json(pub)
    }))
  }
  return { routes, PRICE }
}

module.exports = { createLookup, PRICE }
