/* E2E: Reseller Payouts — WL sales.js payout ledger API + main-bot admin controller (real HTTP + local MongoDB). */
const assert = require('assert')
const express = require('express')
const { MongoClient } = require('mongodb')

process.env.SALES_FLAT_MARGIN_PCT = '30'
process.env.PAYOUT_ADMIN_KEY = 'k'.repeat(40)
process.env.SALES_DASHBOARD_PASSWORD = 'dash-pass'
process.env.SESSION_SECRET = 'test-secret'
process.env.CHAT_BOT_BRAND = 'Test Bot'

const MONGO = process.env.TEST_MONGO_URL || 'mongodb://127.0.0.1:27017'
const DB = 'payout_e2e_test'
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✅', name) } else { fail++; console.log('  ❌', name) } }

;(async () => {
  const client = await MongoClient.connect(MONGO)
  const db = client.db(DB)
  await db.dropDatabase()
  const now = new Date()
  await db.collection('transactions').insertMany([
    { _id: 's1', chatId: 'u1', type: 'domain', amount: 100, currency: 'USD', status: 'completed', createdAt: now, metadata: { domain: 'a.com' } },
    { _id: 's2', chatId: 'u2', type: 'vps', amount: 50, currency: 'USD', status: 'completed', createdAt: now, metadata: { plan: 'v1' } },
    { _id: 'd1', chatId: 'u2', type: 'wallet-topup', amount: 500, currency: 'USD', status: 'completed', createdAt: now, metadata: {} },
  ])

  const app = express()
  app.use((req, _res, next) => { req.url = req.url.replace(/^\/api/, ''); next() })
  require('../routes/sales.js').install(app, { getDb: () => db, log: () => {} })
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
  const base = `http://127.0.0.1:${server.address().port}`
  process.env.RESELLER_PAYOUT_BOTS = `t1|Test Bot|${base};t2|Broken Bot|http://127.0.0.1:1`

  const rp = require('../reseller-payouts')
  const msgs = []
  let mid = 100
  const bot = {
    sendMessage: async (chatId, text, opts) => { const m = { message_id: ++mid, text, opts }; msgs.push(m); return m },
    editMessageText: async (text, opts) => { const m = msgs.find((x) => x.message_id === opts.message_id); m.text = text; m.opts = opts; return m },
  }
  const pend = {}
  const admin = require('../reseller-payouts-admin').createPayoutAdmin({
    getBot: () => bot, getPending: async (id) => pend[id], setPending: async (id, v) => { pend[id] = v }, log: () => {},
  })
  const A = '5590563715'
  const q = (msgId) => ({ message: { message_id: msgId }, from: { id: A, username: 'onarrival1' } })
  const ack = async () => {}
  const last = () => msgs[msgs.length - 1]
  const buttons = (m) => (m.opts.reply_markup?.inline_keyboard || []).flat().map((b) => b.text)
  const api = async (method, path, body, headers = { 'X-Payout-Key': process.env.PAYOUT_ADMIN_KEY }) => {
    const r = await fetch(`${base}/admin/sales${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, body: await r.json() }
  }

  console.log('Admin flow')
  await admin.open(A)
  const screen = last()
  ok(/Test Bot<\/b> — \$45\.00 eligible · never paid/.test(screen.text), 'overview shows Test Bot $45.00 eligible, never paid')
  ok(/Broken Bot<\/b> — ⚠️ couldn't load/.test(screen.text), 'overview shows unreachable bot as a warning, not a crash')
  ok(buttons(screen).includes('Test Bot · $45.00'), 'overview has a button per bot with its amount')

  await admin.onCallback(q(screen.message_id), 'o:t1', A, ack)
  ok(/Eligible now: <b>\$45\.00<\/b>/.test(screen.text) && /Paid to date: \$0\.00/.test(screen.text), 'card shows eligible $45.00 and paid $0.00')
  ok(buttons(screen).includes('✅ Mark all $45.00 paid') && buttons(screen).includes('✏️ Enter amount') && !buttons(screen).includes('↩️ Undo last'), 'card offers Mark all / Enter amount, no Undo yet')

  await admin.onCallback(q(screen.message_id), 'amt:t1', A, ack)
  ok(pend[A]?.step === 'amount' && /up to \$45\.00/.test(screen.text), 'Enter amount asks for a typed amount (up to $45.00)')
  await admin.onText(A, pend[A], 'abc')
  ok(/isn't a valid amount/.test(last().text) && pend[A].step === 'amount', 'invalid amount is rejected and re-prompted')
  await admin.onText(A, pend[A], '50')
  ok(/more than the eligible \$45\.00/.test(last().text), 'amount above eligible is rejected')
  await admin.onText(A, pend[A], '$20.50')
  ok(pend[A].step === 'note' && pend[A].amount === 20.5 && /Paying <b>\$20\.50<\/b>/.test(last().text), 'valid amount moves to the note step')
  await admin.onText(A, pend[A], 'USDT TRC20 tx 0xabc')
  const confirm = last()
  ok(/Record <b>\$20\.50<\/b> as paid to <b>Test Bot<\/b>/.test(confirm.text) && /\$45\.00 → \$24\.50/.test(confirm.text) && /Note: USDT TRC20 tx 0xabc/.test(confirm.text), 'confirm screen shows amount, note and eligible change')
  const reqId = pend[A].requestId
  await admin.onCallback(q(confirm.message_id), 'ok', A, ack)
  ok(/Recorded <b>\$20\.50<\/b> paid to <b>Test Bot<\/b>/.test(confirm.text) && /Eligible now: <b>\$24\.50<\/b>/.test(confirm.text) && pend[A] === null, 'Confirm records the payout and shows eligible $24.50')
  await admin.onCallback(q(confirm.message_id), 'ok', A, ack)
  ok(/expired/.test(confirm.text), 'a second tap on Confirm does not record twice')
  const dup = await api('POST', '/payouts', { amount: 20.5, requestId: reqId, recordedBy: { chatId: A } })
  ok(dup.status === 200 && dup.body.duplicate === true && dup.body.paidToDate === 20.5, 'same requestId is idempotent on the API (no double payout)')

  await admin.onCallback(q(screen.message_id), 'all:t1', A, ack)
  ok(pend[A].step === 'note' && pend[A].amount === 24.5, 'Mark all goes straight to the note step for the full $24.50')
  await admin.onCallback(q(screen.message_id), 'skip', A, ack)
  ok(pend[A].step === 'confirm' && pend[A].note === '', 'Skip note goes to confirm')
  await admin.onCallback(q(screen.message_id), 'ok', A, ack)
  ok(/Eligible now: <b>\$0\.00<\/b>/.test(screen.text), 'paying the rest resets eligible to $0.00')
  await admin.onCallback(q(screen.message_id), 'o:t1', A, ack)
  ok(!buttons(screen).some((b) => b.startsWith('✅ Mark all')) && buttons(screen).includes('↩️ Undo last'), 'at $0 the card hides pay buttons and offers Undo')

  await admin.onCallback(q(screen.message_id), 'h:t1', A, ack)
  ok(/\$24\.50/.test(screen.text) && /\$20\.50 · USDT TRC20 tx 0xabc · by @onarrival1/.test(screen.text), 'history lists both payouts with note and admin')

  await admin.onCallback(q(screen.message_id), 'u:t1', A, ack)
  ok(pend[A].step === 'undo' && /Undo the last payout to <b>Test Bot<\/b>: \$24\.50/.test(screen.text), 'Undo last asks to confirm the latest payout')
  await admin.onCallback(q(screen.message_id), 'uok', A, ack)
  ok(/Undid the <b>\$24\.50<\/b> payout/.test(screen.text) && /Eligible now: <b>\$24\.50<\/b>/.test(screen.text), 'undo restores eligible to $24.50')
  await admin.onCallback(q(screen.message_id), 'h:t1', A, ack)
  ok(/<s>.*\$24\.50.*<\/s> \(undone/.test(screen.text), 'undone payout stays in history, struck through')

  await admin.onCallback(q(screen.message_id), 'amt:t1', A, ack)
  await admin.onCallback(q(screen.message_id), 'x', A, ack)
  ok(pend[A] === null && /Cancelled/.test(screen.text), 'Cancel clears the pending payout')
  pend[A] = { type: 'payout', step: 'confirm', bot: 't1', amount: 1, note: '', requestId: 'stale-req-0001', eligible: 24.5, ts: Date.now() - 11 * 60000 }
  await admin.onCallback(q(screen.message_id), 'ok', A, ack)
  const afterStale = await api('GET', '/payouts')
  ok(/expired/.test(screen.text) && afterStale.body.paidToDate === 20.5, 'a confirm older than 10 minutes is refused (nothing recorded)')

  console.log('API guards')
  ok((await api('POST', '/payouts', { amount: 30, requestId: 'over-amount-01' })).status === 400, 'over-eligible amount → 400')
  ok((await api('POST', '/payouts', { amount: 0, requestId: 'zero-amount-01' })).status === 400, 'zero amount → 400')
  ok((await api('POST', '/payouts', { amount: 1, requestId: 'x' })).status === 400, 'bad requestId → 400')
  ok((await api('POST', '/payouts', { amount: 1, requestId: 'wrong-key-0001' }, { 'X-Payout-Key': 'k'.repeat(39) + 'x' })).status === 401, 'wrong payout key → 401')
  ok((await api('GET', '/payouts', null, {})).status === 401, 'no key and no token → 401')
  ok((await api('POST', '/payouts/undo-last', { id: 'not-the-last' })).status === 409, 'undo with a stale id → 409')
  const token = (await api('POST', '/login', { password: 'dash-pass' }, {})).body.token
  ok((await api('POST', '/payouts', { amount: 1, requestId: 'owner-token-01' }, { Authorization: `Bearer ${token}` })).status === 401, 'owner dashboard token cannot record payouts')
  const ownerView = await api('GET', '/payouts', null, { Authorization: `Bearer ${token}` })
  ok(ownerView.status === 200 && ownerView.body.eligible === 24.5 && ownerView.body.history.every((h) => !('recordedBy' in h)), 'owner token can read payouts (admin identity hidden)')
  const ov = await api('GET', '/overview?range=30d', null, { Authorization: `Bearer ${token}` })
  const s = ov.body.summary
  ok(s.eligiblePayout === 24.5 && s.payoutEarnedToDate === 45 && s.payoutPaidToDate === 20.5 && s.lastPayout?.amount === 20.5 && ov.body.payouts.length === 2, 'dashboard overview: eligible 24.50, earned 45, paid 20.50, last paid 20.50, 2 history rows')
  ok(s.deposits === 500 && s.eligiblePayout < s.deposits, 'wallet deposits still never count toward payout')

  console.log('Parsing')
  ok(rp.parseAmount('200') === 200 && rp.parseAmount('$1,250.5') === 1250.5 && rp.parseAmount('99.99 USD') === 99.99, 'parseAmount accepts 200 / $1,250.5 / 99.99 USD')
  ok([ '0', '-5', '1.234', 'ten', '' ].every((v) => Number.isNaN(rp.parseAmount(v))), 'parseAmount rejects 0, negatives, 3 decimals, words, empty')

  server.close()
  await db.dropDatabase()
  await client.close()
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
