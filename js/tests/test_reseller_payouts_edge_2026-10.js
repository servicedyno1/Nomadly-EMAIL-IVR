/* Edge cases: Reseller Payouts — key auth robustness, concurrency, history window, UI helpers. Uses DB payout_edge_test. */
const assert = require('assert')
const express = require('express')
const http = require('http')
const { MongoClient } = require('mongodb')

process.env.SALES_FLAT_MARGIN_PCT = '30'
process.env.PAYOUT_ADMIN_KEY = 'k'.repeat(40)
process.env.SALES_DASHBOARD_PASSWORD = 'dash-pass'
process.env.SESSION_SECRET = 'test-secret'

const MONGO = process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27017'
let pass = 0, fail = 0
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ✅', name) } else { fail++; console.log('  ❌', name, extra) } }

;(async () => {
  const client = await MongoClient.connect(MONGO)
  const db = client.db('payout_edge_test')
  await db.dropDatabase()
  const now = new Date()
  await db.collection('transactions').insertMany([
    { _id: 's1', chatId: 'u1', type: 'domain', amount: 100, currency: 'USD', status: 'completed', createdAt: now, metadata: {} },
  ]) // 30% → $30 earned
  const app = express()
  require('../routes/sales.js').install(app, { getDb: () => db, log: () => {} })
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  const K = process.env.PAYOUT_ADMIN_KEY
  const api = async (method, path, body, headers = { 'X-Payout-Key': K }) => {
    const r = await fetch(`${base}/admin/sales${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, body: await r.json().catch(() => ({})) }
  }
  // raw http so we can send latin1 header bytes (fetch rejects non-ASCII)
  const rawGet = (keyLatin1) => new Promise((res) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/admin/sales/payouts', method: 'GET', headers: { 'X-Payout-Key': Buffer.from(keyLatin1, 'latin1').toString('latin1') } }, (r) => { r.resume(); r.on('end', () => res(r.statusCode)) })
    req.on('error', () => res(-1)); req.end()
  })

  console.log('Auth robustness')
  const st1 = await rawGet('é' + 'k'.repeat(39)) // same char length, different byte length
  ok(st1 === 401, 'non-ASCII X-Payout-Key of equal length → 401 (not 500)', `got ${st1}`)
  const short = await api('POST', '/payouts', { amount: 1, requestId: 'abcdefgh1' }, { 'X-Payout-Key': 'k'.repeat(39) })
  ok(short.status === 401, 'shorter key → 401')

  console.log('Validation')
  const s = await api('POST', '/payouts', { amount: '5', requestId: 'strnum-0001' })
  ok(s.status === 200 && s.body.paidToDate === 5, 'string amount "5" accepted and coerced', JSON.stringify(s.body))
  const nanA = await api('POST', '/payouts', { amount: 'abc', requestId: 'nan-000001' })
  ok(nanA.status === 400, 'non-numeric amount → 400')
  const tiny = await api('POST', '/payouts', { amount: 0.004, requestId: 'tiny-00001' })
  ok(tiny.status === 400, '0.004 rounds to 0 → 400')
  const rounding = await api('POST', '/payouts', { amount: 25.004, requestId: 'round-0001' })
  ok(rounding.status === 200 && rounding.body.eligible === 0, 'amount within rounding of eligible (25.004 vs 25) accepted, eligible 0', JSON.stringify(rounding.body).slice(0, 200))
  await api('POST', '/payouts/undo-last', {})
  await api('POST', '/payouts/undo-last', {})

  console.log('Concurrency (two different requestIds racing for the same eligible)')
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => api('POST', '/payouts', { amount: 30, requestId: `race-${i}-0001` })))
  const [c1, c2] = [rs.filter((r) => r.status === 200), rs.filter((r) => r.status !== 200)].map((a) => ({ status: a.length }))
  const after = await api('GET', '/payouts')
  ok(after.body.paidToDate <= 30, 'concurrent full payouts cannot overpay (paidToDate ≤ earned)', `statuses ${c1.status}/${c2.status} paidToDate=${after.body.paidToDate} eligible=${after.body.eligible}`)
  // reset
  while ((await api('POST', '/payouts/undo-last', {})).status === 200) { /* void all */ }

  console.log('Same requestId racing')
  const [d1, d2] = await Promise.all([
    api('POST', '/payouts', { amount: 3, requestId: 'dup-race-01' }),
    api('POST', '/payouts', { amount: 3, requestId: 'dup-race-01' }),
  ])
  const afterDup = await api('GET', '/payouts')
  ok(d1.status === 200 && d2.status === 200 && afterDup.body.paidToDate === 3, 'same requestId concurrently → one payout, both 200', `${d1.status}/${d2.status} paid=${afterDup.body.paidToDate}`)
  await api('POST', '/payouts/undo-last', {})

  console.log('History window')
  const col = db.collection('resellerPayouts')
  await col.insertOne({ requestId: 'old-real-01', amount: 2, paidAt: new Date(Date.now() - 86400e3 * 30), note: '' })
  const docs = []
  for (let i = 0; i < 21; i++) docs.push({ requestId: `voided-${i}-xx`, amount: 1, paidAt: new Date(Date.now() - 1000 * (i + 1)), voided: true, voidedAt: new Date() })
  await col.insertMany(docs)
  const h = await api('GET', '/payouts')
  ok(h.body.paidToDate === 2, 'paidToDate counts only non-voided ($2)')
  ok(h.body.lastPayout && h.body.lastPayout.amount === 2, 'lastPayout found even when >20 newer payouts are voided', `lastPayout=${JSON.stringify(h.body.lastPayout)}`)
  ok(h.body.history.length === 20 && new Date(h.body.history[0].paidAt) >= new Date(h.body.history[19].paidAt), 'history capped at 20, newest first')
  await col.deleteMany({})

  console.log('Negative eligible (refund after payout)')
  await api('POST', '/payouts', { amount: 30, requestId: 'full-pay-01' })
  await db.collection('transactions').insertOne({ _id: 'r1', chatId: 'u1', type: 'refund', amount: 100, currency: 'USD', status: 'completed', createdAt: new Date(), metadata: {} })
  const neg = await api('GET', '/payouts')
  ok(typeof neg.body.eligible === 'number', `eligible after refund is numeric (${neg.body.eligible})`)
  const negPost = await api('POST', '/payouts', { amount: 1, requestId: 'neg-pay-01' })
  ok(negPost.status === 400, 'cannot record when eligible ≤ 0')
  await db.collection('transactions').deleteOne({ _id: 'r1' })
  await col.deleteMany({})

  console.log('Telegram views')
  process.env.RESELLER_PAYOUT_BOTS = `abcdefghijklmnop|<b>Evil & Co</b>|${base}/; bad id!|X|http://x; ok2|No URL|ftp://x;`
  delete require.cache[require.resolve('../reseller-payouts')]
  const rp = require('../reseller-payouts')
  ok(rp.bots().length === 1 && rp.bots()[0].url === base, 'RESELLER_PAYOUT_BOTS parsing: trims trailing slash, drops invalid id / non-http url / empty entry')
  const b = rp.bots()[0]
  const st = { eligible: 12.34, earnedToDate: 20, paidToDate: 7.66, lastPayout: { id: 'x', amount: 7.66, paidAt: now, note: '<script>&' }, history: [{ id: 'x', amount: 7.66, paidAt: now, note: '<i>n</i>', voided: true, voidedAt: now, recordedBy: { username: 'a<b' } }] }
  const views = [rp.card(b, st), rp.history(b, st), rp.amountPrompt(b, 1), rp.notePrompt(b, 1), rp.confirmView(b, { amount: 1, eligible: 2, note: '<x>' }), rp.undoView(b, st.lastPayout, 1)]
  ok(views.every((v) => !/<script>|<i>n|<x>|<b>Evil/.test(v.text)), 'bot name / notes / usernames are HTML-escaped in all views')
  const allData = views.flatMap((v) => v.keyboard.flat().map((k) => k.callback_data))
  ok(allData.every((d) => Buffer.byteLength(d) <= 64), `all callback_data ≤ 64 bytes (max ${Math.max(...allData.map((d) => Buffer.byteLength(d)))})`)
  ok(rp.usd(-3.5) === '−$3.50' && /paid more than earned/.test(rp.card(b, { ...st, eligible: -1 }).text) && !rp.card(b, { ...st, eligible: -1 }).keyboard.flat().some((k) => /Mark all/.test(k.text)), 'negative eligible: shown with minus, no Mark-all button')
  ok(Number.isNaN(rp.parseAmount('1e3')) && Number.isNaN(rp.parseAmount('.5')) && rp.parseAmount('1,000') === 1000, 'parseAmount: rejects 1e3/.5, accepts 1,000')

  console.log('Controller: not-modified + TTL')
  let sent = 0
  const bot = { sendMessage: async () => { sent++; return { message_id: 1 } }, editMessageText: async () => { throw new Error('ETELEGRAM: 400 Bad Request: message is not modified') } }
  const pend = {}
  const ctl = require('../reseller-payouts-admin').createPayoutAdmin({ getBot: () => bot, getPending: async (id) => pend[id], setPending: async (id, v) => { pend[id] = v }, log: () => {} })
  await ctl.show('1', rp.doneView('x'), 5)
  ok(sent === 0, '"message is not modified" is swallowed (no duplicate send)')
  pend['1'] = { type: 'payout', step: 'confirm', bot: b.id, amount: 1, eligible: 30, requestId: 'ttl-expired-1', ts: Date.now() - 11 * 60 * 1000 }
  let txt = ''
  bot.editMessageText = async (t) => { txt = t; return {} }
  await ctl.onCallback({ message: { message_id: 5 }, from: { username: 'a' } }, 'ok', '1', async () => {})
  const nothing = await api('GET', '/payouts')
  ok(/expired/.test(txt) && nothing.body.paidToDate === 0, 'Confirm after 10-min TTL → expired, nothing recorded')

  server.close(); await db.dropDatabase(); await client.close()
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
