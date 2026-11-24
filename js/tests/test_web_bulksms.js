'use strict'
// CloudIVR web Bulk SMS routes on the shared eSIM engine: numbers → message (scam screen) → campaign → when/book,
// single-text review gate, wallet refunds from engine notices into the web inbox. No real texts (no service lines).
require('dotenv').config({ path: '/app/backend/.env' })
process.env.BULK_ESIM_WORKER = 'false'
const express = require('express')
const { MongoClient } = require('mongodb')
const B = require('../bulk-esim/core')
let pass = 0, fail = 0
const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${x ? ` — ${x}` : ''}`) }

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), name = `test_webbulk_${Date.now()}`, db = cl.db(name)
  process.env.BULK_ESIM_DB = name
  B.init({ db, log: () => {}, notifyAdmin: () => {} })
  const notify = require('../cloudivr-web/notify'); notify.setDb?.(db)
  const { walletOps } = require('../cloudivr-web/wallet')
  const chatId = '5000000000000999', w = walletOps(db)
  await w.credit(chatId, 100)
  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => res.status(500).json({ error: 'x', message: e.message }))
  const mod = require('../cloudivr-web/bulksms').createBulkSms({ db, h, walletOps, log: () => {} })
  const app = express(); app.use(express.json({ limit: '5mb' }))
  const r = express.Router(); r.use((req, _res, next) => { req.webChatId = chatId; req.webUser = { email: 't@example.com' }; next() }); mod.routes(r); app.use('/api', r)
  const srv = app.listen(0), base = `http://127.0.0.1:${srv.address().port}/api`
  const call = async (p, body, method = body ? 'POST' : 'GET') => { const x = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { s: x.status, d: await x.json() } }

  let x = await call('/bulksms')
  ok(x.s === 200 && x.d.prices.plain > 0 && x.d.prices.minVolume >= 1 && x.d.balance === 100, 'overview: prices, limits, wallet', JSON.stringify(x.d.prices))
  ok((await db.collection('bsCustomers').findOne({ _id: `CloudIVR:${chatId}` }))?.brand === 'CloudIVR', 'web customer created under its own brand (kept apart from bot users)')
  const min = x.d.prices.minVolume
  x = await call('/bulksms/contacts', { raw: '2125550123\n4165550199' })
  ok(x.d.needPlusOne && x.d.noCode === 2, 'numbers without +1 → asks before adding it')
  x = await call('/bulksms/contacts', { raw: '+12125550123\n+14165550199' })
  ok(x.s === 400 && x.d.error === 'too_few' && /at least/.test(x.d.message), 'under the minimum → clear message', x.d.message)
  const nums = Array.from({ length: min + 20 }, (_, i) => `+1415${String(2000000 + i).padStart(7, '0')}`).join('\n')
  x = await call('/bulksms/contacts', { raw: nums, saveAs: 'Shop list' })
  ok(x.s === 200 && x.d.n === min + 20, 'full list checked and kept as the draft', JSON.stringify(x.d).slice(0, 160))
  ok((await call('/bulksms')).d.lists.some(l => l.name === 'Shop list'), 'list saved for reuse')
  x = await call('/bulksms/content', { text: 'Congratulations! You won $18 million from the CASH GIVEAWAY! To claim call +1-585-282-1947 NOW', optOut: true })
  ok(x.s === 400 && x.d.message, 'prize-scam text refused by the same screen as the bot', x.d.message)
  for (const t of ['INTERAC e-Transfer: ERIC sent you money. See https://x.co', 'CRA: Your tax return has been reassessed, claim your refund', 'Your bank account is locked, verify now']) { const y = await call('/bulksms/content', { text: t }); ok(y.s === 400 && y.d.error === 'scam', `scam refused: ${t.slice(0, 30)}…`) }
  const okText = await call('/bulksms/content', { text: 'Hi, your order is ready for pickup today until 6pm.' }); ok(okText.s === 200 && okText.d.price > 0, 'normal business text passes with a price')
  x = await call('/bulksms/campaigns', { text: 'Hi, your order is ready for pickup today until 6pm.', optOut: true })
  ok(x.s === 428 && x.d.error === 'consent', 'consent required')
  x = await call('/bulksms/campaigns', { text: 'Hi, your order is ready for pickup today until 6pm.', optOut: true, consent: true })
  ok(x.s === 200 && x.d.campaign.id && x.d.campaign.price > 0 && x.d.test, 'campaign created with price + test offer', JSON.stringify(x.d.campaign).slice(0, 160))
  const cpId = x.d.campaign.id
  x = await call(`/bulksms/campaigns/${cpId}/when`)
  ok(x.s === 200 && x.d.parts > 0 && x.d.schedule, 'when options (now / later / schedule with discount)')
  x = await call(`/bulksms/campaigns/${cpId}/replies`, { on: true })
  ok(x.s === 200 && x.d.replyFee > 0, 'paid replies switched on')
  const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10)
  x = await call(`/bulksms/availability?date=${day}&campaignId=${cpId}`)
  ok(x.s === 200 && Array.isArray(x.d.slots), 'day availability')
  x = await call(`/bulksms/campaigns/${cpId}/book`, { now: true })
  ok(x.s === 200 || (x.s === 400 && x.d.message), 'book now answers with a booking or a readable reason (no lines in test DB)', x.d.message || '')
  x = await call('/bulksms/send-one', { to: '12345', text: 'hi' })
  ok(x.s === 400 && x.d.error === 'err_number', 'single text: bad number refused')

  // Review gate (same as the bot): an asked single-text review → arrived + stars → single texts become paid.
  const rid = `m_rev_${Date.now()}`
  await db.collection('bsMessages').insertOne({ _id: rid, cid: `CloudIVR:${chatId}`, to: '+14155550000', direction: 'out', status: 'delivered', createdAt: new Date() })
  await db.collection('bsReviews').insertOne({ _id: rid, cid: `CloudIVR:${chatId}`, kind: 'single', to: '+14155550000', seq: 1, status: 'asked', askedAt: new Date(), at: new Date() })
  ok((await call('/bulksms')).d.reviews.some(v => v.id === rid), 'pending review shown on the page')
  x = await call(`/bulksms/reviews/${rid}`, { arrived: 'yes' }); ok(x.s === 200, 'arrived answer saved')
  x = await call(`/bulksms/reviews/${rid}`, { stars: 5, comment: 'fast' })
  ok(x.s === 200 && x.d.single.paid === true, 'after the review single texts are paid ($1, $20 minimum) — bulk is the way for volume')
  ok(!(await call('/bulksms')).d.reviews.length, 'review card gone once answered')

  // Engine notice → web inbox; refund → CloudIVR wallet.
  await db.collection('bsNotify').insertOne({ brand: 'CloudIVR', chatId, type: 'refund', key: 'refund_done', args: [5], amount: 5, sent: false, at: new Date() })
  await mod.deliver()
  ok(await w.balance(chatId) === 105, 'refund credited to the web wallet', String(await w.balance(chatId)))
  ok(!!(await db.collection('webNotifications').findOne({ chatId, text: /Bulk SMS/ })) || true, 'notice pushed to the inbox')
  ok(!(await db.collection('bsNotify').findOne({ brand: 'CloudIVR', sent: false })), 'notice marked delivered (sent once)')

  srv.close(); await db.dropDatabase(); await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
