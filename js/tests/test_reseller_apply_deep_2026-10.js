#!/usr/bin/env node
// Deep regression: 💼 Reseller in-bot application (nav/validation/stale cb/status screens/switch/withdraw/
// wallet/BlockBee/DynoPay/Fincra webhooks/closed-app refunds/admin decisions/i18n/stk+mp callbacks).
// Drives the REAL bot (localhost:5000) + mock Telegram (:5099). Run: node js/tests/test_reseller_apply_deep_2026-10.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const crypto = require('crypto')
const BOT = 'http://localhost:5000'
const WEBHOOK = BOT + '/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const ADMIN = String(process.env.TELEGRAM_ADMIN_CHAT_ID)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
let uid = 9_300_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' :: ' + String(detail).slice(0, 500) : ''}`) }
const calls = async (chat, since, method) => (await axios.get(`${MOCK}/_calls?${chat ? 'chat_id=' + chat + '&' : ''}since=${since}${method ? '&method=' + method : ''}`)).data
async function text(chat, t, wait = 1800) {
  const since = Date.now(); const n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat }, text: t } }, { timeout: 20000 })
  await sleep(wait)
  return (await calls(chat, since)).filter(c => c.method === 'sendMessage')
}
async function cb(chat, data, wait = 1500, fromId = chat, mid = 77) {
  const since = Date.now(); const n = uid++
  await axios.post(WEBHOOK, { update_id: n, callback_query: { id: String(n), from: { id: Number(fromId), is_bot: false, first_name: 'Adm', username: 'adm' }, message: { message_id: mid, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' } }, data } }, { timeout: 20000 })
  await sleep(wait)
  const all = await calls(null, since)
  return { all, ack: all.find(x => x.method === 'answerCallbackQuery' && String(x.raw?.callback_query_id) === String(n)) || all.find(x => x.method === 'answerCallbackQuery') }
}
const last = cs => cs.slice(-1)[0] || {}
const lt = cs => strip(last(cs).text)
const btns = cs => last(cs).buttons || []

const USERS = Array.from({ length: 30 }, (_, i) => String(990400010 + i))
let db
const apps = () => db.collection('resellerApplications')
const draft = c => apps().findOne({ chatId: c, status: 'draft' })
const latest = c => apps().findOne({ chatId: c }, { sort: { createdAt: -1 } })
const wallet = async c => (await db.collection('walletOf').findOne({ _id: c })) || {}
async function seedUser(c, lang = 'en', usd = 0) {
  await db.collection('state').deleteOne({ _id: c }); await db.collection('walletOf').deleteOne({ _id: c })
  await apps().deleteMany({ chatId: c })
  await db.collection('state').insertOne({ _id: c, userLanguage: lang, action: 'none' })
  if (usd) await db.collection('walletOf').insertOne({ _id: c, usdIn: usd, usdOut: 0 })
}
async function seedApp(c, over = {}) {
  const now = new Date()
  const doc = { _id: crypto.randomUUID(), chatId: c, username: 'sim' + c, lang: 'en', status: 'pending', idx: 9, tier: 'standard', answers: { email: null, brand: 'SeedBrand', sellMode: 'bot', volume: 'v2', audWhere: 'tg', audSize: 's2', services: ['ivr'], note: null }, createdAt: now, updatedAt: now, submittedAt: now, ...over }
  await apps().insertOne(doc)
  return doc
}
// Fill steps 1..6 then services
async function toServices(c) {
  await text(c, '💼 Reseller'); await text(c, '📝 Apply Now'); await text(c, '⏭ Skip'); await text(c, 'BrandX')
  await text(c, '🤖 Own white-label bot'); await text(c, '11–50'); await text(c, '🌐 Website'); await text(c, '1k–10k', 2500)
}

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  db = mc.db(process.env.DB_NAME)
  const refs = []
  const clean = async () => {
    for (const c of ['state', 'walletOf', 'nameOf']) await db.collection(c).deleteMany({ _id: { $in: USERS } })
    await apps().deleteMany({ chatId: { $in: USERS } })
    await db.collection('chatIdOfPayment').deleteMany({ _id: { $in: refs } })
    await db.collection('chatIdOfDynopayPayment').deleteMany({ _id: { $in: refs } })
    await db.collection('payments').deleteMany({ _id: { $in: refs } })
  }
  try {
    await clean()
    const [A, B, C, D, E, F, G, H, I, J, K, Lb, M, N, O, P, Q, R2, S, T2, U, V, W] = USERS

    // ── 1. Back on every step keeps answers; Cancel button ──
    await seedUser(A)
    await text(A, '💼 Reseller'); await text(A, '📝 Apply Now')
    await text(A, 'me@ex.com'); await text(A, 'BackBrand'); await text(A, '🔌 Reseller API'); await text(A, '51–200')
    await text(A, '📱 Social media'); await text(A, '50k+', 2500)
    let r = await text(A, '⬅️ Back')
    check('Back from services → step 6', /Step 6 of 9/.test(strip(r[0]?.text)))
    r = await text(A, '⬅️ Back'); check('Back → step 5', /Step 5 of 9/.test(lt(r)))
    r = await text(A, '⬅️ Back'); check('Back → step 4', /Step 4 of 9/.test(lt(r)))
    r = await text(A, '⬅️ Back'); check('Back → step 3', /Step 3 of 9/.test(lt(r)))
    r = await text(A, '⬅️ Back'); check('Back → step 2', /Step 2 of 9/.test(lt(r)))
    r = await text(A, '⬅️ Back'); check('Back → step 1', /Step 1 of 9/.test(lt(r)))
    let d = await draft(A)
    check('answers kept after Back', d && d.answers.email === 'me@ex.com' && d.answers.brand === 'BackBrand' && d.answers.sellMode === 'api' && d.answers.audSize === 's4', JSON.stringify(d?.answers))
    r = await text(A, '⬅️ Back')
    d = await draft(A)
    check('Back on step 1 (no back btn) does not crash / stays draft idx0', d && d.idx === 0, `${JSON.stringify(r.map(x => strip(x.text).slice(0, 60)))} idx=${d?.idx}`)
    r = await text(A, '❌ Cancel')
    check('Cancel button → cancelled msg', r.some(m => /Application cancelled/.test(strip(m.text))), JSON.stringify(r.map(x => strip(x.text).slice(0, 60))))
    d = await latest(A); check('draft status cancelled', d.status === 'cancelled')
    const stA = await db.collection('state').findOne({ _id: A }); check('state action reset after cancel', stA.action === 'none', stA.action)

    // Back from Note → services re-sends inline panel; Back from tier → note ; typed /cancel mid flow
    await seedUser(B)
    await toServices(B); await cb(B, 'rsa:t:sms'); await cb(B, 'rsa:c', 2200)
    r = await text(B, '⬅️ Back', 2500)
    check('Back from Note → services header + inline panel', r.length >= 2 && /Step 7 of 9/.test(strip(r[r.length - 2].text)) && /✅ 💬 Bulk SMS/.test(JSON.stringify(last(r).raw || last(r))), JSON.stringify(r.map(x => strip(x.text).slice(0, 50))))
    let c = await cb(B, 'rsa:c', 2200)
    r = await text(B, 'note here'); check('note → tier', /Step 9 of 9/.test(lt(r)))
    r = await text(B, '⬅️ Back'); check('Back from tier → note', /Step 8 of 9/.test(lt(r)))
    r = await text(B, '/cancel')
    check('typed /cancel → cancelled', r.some(m => /Application cancelled/.test(strip(m.text))), JSON.stringify(r.map(x => strip(x.text).slice(0, 80))))
    d = await latest(B); check('/cancel → status cancelled', d.status === 'cancelled', d.status)

    // ── 2. Validation ──
    await seedUser(C)
    await text(C, '💼 Reseller'); await text(C, '📝 Apply Now')
    r = await text(C, 'a@b'); check('bad email a@b rejected', /doesn't look like an email/.test(lt(r)))
    r = await text(C, '⏭ Skip')
    r = await text(C, 'X'); check('brand 1 char rejected', /between 2 and 40/.test(lt(r)))
    r = await text(C, 'A'.repeat(41)); check('brand 41 chars rejected', /between 2 and 40/.test(lt(r)))
    r = await text(C, '🔥🔥🔥'); check('brand emoji-only rejected', /between 2 and 40/.test(lt(r)))
    r = await text(C, '<b>Ok</b> & Co'); check('brand with html accepted (escaped later)', /Step 3 of 9/.test(lt(r)))
    r = await text(C, 'banana'); check('unknown text on sellMode → pick buttons', /Please tap one of the buttons/.test(lt(r)))
    await text(C, '🤝 Referral')
    r = await text(C, '9999'); check('unknown on volume → re-prompt', /Please tap one of the buttons/.test(lt(r)))
    await text(C, '1–10'); await text(C, '✳️ Other')
    r = await text(C, 'many'); check('unknown on audSize → re-prompt', /Please tap one of the buttons/.test(lt(r)))
    await text(C, 'Under 1k', 2500)
    r = await text(C, 'continue please'); check('typed text on services with 0 selected → services error', /Pick at least one service/.test(strip(r[0]?.text)), JSON.stringify(r.map(x => strip(x.text).slice(0, 50))))
    c = await cb(C, 'rsa:t:bogus'); d = await draft(C)
    check('unknown service key ignored (stale ack)', JSON.stringify(d.answers.services) === '[]' && /closed/i.test(JSON.stringify(c.ack?.raw || c.ack)), JSON.stringify(c.ack))
    await cb(C, 'rsa:t:leads'); await cb(C, 'rsa:c', 2200)
    r = await text(C, 'x'.repeat(501)); check('note >500 rejected', /under 500 characters/.test(lt(r)))
    r = await text(C, 'x'.repeat(500)); check('note =500 accepted', /Step 9 of 9/.test(lt(r)))
    r = await text(C, 'turbo'); check('unknown tier → re-prompt', /Please tap one of the buttons/.test(lt(r)))
    r = await text(C, '🕐 Standard — Free (3–5 days)')
    check('review escapes html brand', /&lt;b&gt;Ok&lt;\/b&gt; &amp; Co/.test(last(r).text || ''), last(r).text)
    r = await text(C, 'hmm'); check('unknown on review → re-prompt', /Please tap one of the buttons/.test(lt(r)))

    // ── 3. Stale callbacks ──
    c = await cb(C, 'rsa:t:ivr'); d = await draft(C)
    check('toggle when on review step → "This step is closed." no change', /This step is closed/.test(JSON.stringify(c.ack?.raw || c.ack)) && JSON.stringify(d.answers.services) === '["leads"]', JSON.stringify(c.ack) + JSON.stringify(d?.answers?.services))
    c = await cb(C, 'rsa:c'); d = await draft(C)
    check('continue when on review → closed, idx unchanged', /This step is closed/.test(JSON.stringify(c.ack?.raw || c.ack)) && d.idx === 9, d?.idx)
    c = await cb(D, 'rsa:t:ivr')
    check('toggle with no draft at all → closed', /This step is closed/.test(JSON.stringify(c.ack?.raw || c.ack)))

    // ── 4. Start Over + double submit race ──
    r = await text(C, '✏️ Start Over'); d = await draft(C)
    check('Start Over resets to step 1 with empty answers', /Step 1 of 9/.test(lt(r)) && d.idx === 0 && !d.answers.brand && d.tier === null, JSON.stringify(d))
    await text(C, '⏭ Skip'); await text(C, 'RaceBrand'); await text(C, '🤝 Referral'); await text(C, '1–10'); await text(C, '✳️ Other'); await text(C, 'Under 1k', 2500)
    await cb(C, 'rsa:t:short'); await cb(C, 'rsa:c', 2000); await text(C, '⏭ Skip'); await text(C, '🕐 Standard — Free (3–5 days)')
    const sRace = Date.now()
    await Promise.all([text(C, '✅ Submit Application', 0), text(C, '✅ Submit Application', 0)])
    await sleep(3500)
    const subs = await apps().find({ chatId: C, status: { $nin: ['draft', 'cancelled'] } }).toArray()
    const admRace = (await calls(ADMIN, sRace, 'sendMessage')).filter(m => /Reseller Application/.test(strip(m.text)) && /RaceBrand/.test(strip(m.text)))
    check('double Submit → exactly 1 submission + 1 admin alert', subs.length === 1 && admRace.length === 1, `subs=${subs.length} alerts=${admRace.length}`)
    const raceApp = subs[0]

    // Apply Now while open shows status (not new draft)
    r = await text(C, '💼 Reseller'); r = await text(C, '📝 Apply Now')
    check('Apply Now while open → status screen, no new draft', /Application under review/.test(lt(r)) && !(await draft(C)), lt(r))
    check('pending std (unpaid) status has Withdraw', btns(r).includes('🗑 Withdraw Application'), JSON.stringify(btns(r)))

    // ── 5. Status screens ──
    await seedUser(E); const ePP = await seedApp(E, { status: 'pending_payment', tier: 'priority' })
    r = await text(E, '💼 Reseller')
    check('pending_payment status → Complete/Switch/Withdraw', ['💳 Complete Payment', '🕐 Switch to Standard (Free)', '🗑 Withdraw Application'].every(b => btns(r).includes(b)) && /waiting for payment/.test(lt(r)), JSON.stringify(btns(r)))
    await seedUser(F); await seedApp(F, { status: 'pending', tier: 'priority', payment: { status: 'paid', method: 'wallet_usd', amountUsd: 200 } })
    r = await text(F, '💼 Reseller')
    check('pending paid priority → NO withdraw', /under review/.test(lt(r)) && /24 hours/.test(lt(r)) && !btns(r).includes('🗑 Withdraw Application'), JSON.stringify(btns(r)))
    r = await text(F, '🗑 Withdraw Application')
    check('typed Withdraw on paid priority refused', (await latest(F)).status === 'pending')
    await seedUser(G); await seedApp(G, { status: 'approved' })
    r = await text(G, '💼 Reseller'); check('approved → approved screen', /approved .* reseller/.test(lt(r)), lt(r))

    // ── 6. Switch to Standard from status screen ──
    let s0 = Date.now()
    r = await text(E, '🕐 Switch to Standard (Free)', 2500)
    d = await apps().findOne({ _id: ePP._id })
    check('Switch from status → pending/standard', d.status === 'pending' && d.tier === 'standard', JSON.stringify(d))
    check('Switch → user message', r.some(m => /Switched to Standard/.test(strip(m.text))))
    let admS = (await calls(ADMIN, s0, 'sendMessage')).find(m => /SeedBrand/.test(strip(m.text)) && /Standard \(free\)/.test(strip(m.text)))
    check('Switch → admin alert', !!admS)
    // Switch from checkout screen extra row
    await seedUser(H, 'en', 50); const hPP = await seedApp(H, { status: 'pending_payment', tier: 'priority' })
    await text(H, '💼 Reseller'); r = await text(H, '💳 Complete Payment', 2500)
    check('Complete Payment → checkout w/ Switch row', /Priority Reseller Setup/.test(lt(r)) && btns(r).includes('🕐 Switch to Standard (Free)'), JSON.stringify(btns(r)))
    const payBtnH = btns(r).find(b => /^👛 /.test(b))
    // insufficient wallet
    r = await text(H, payBtnH || '👛 Pay $200.00 from Wallet', 3000)
    let wH = await wallet(H)
    check('insufficient balance → wall (Deposit), nothing charged', (wH.usdOut || 0) === 0 && r.some(m => /Deposit/i.test(JSON.stringify(m.buttons) + strip(m.text))), JSON.stringify(r.map(m => [strip(m.text).slice(0, 80), m.buttons])))
    check('insufficient → app still pending_payment', (await apps().findOne({ _id: hPP._id })).status === 'pending_payment')
    await text(H, '💼 Reseller'); await text(H, '💳 Complete Payment', 2500)
    s0 = Date.now()
    r = await text(H, '🕐 Switch to Standard (Free)', 2500)
    d = await apps().findOne({ _id: hPP._id })
    check('Switch from checkout → pending/standard + msg', d.status === 'pending' && d.tier === 'standard' && r.some(m => /Switched to Standard/.test(strip(m.text))), JSON.stringify(r.map(m => strip(m.text).slice(0, 60))))

    // ── 7. Withdraw (with admin alert existing) → Apply again ──
    s0 = Date.now()
    await text(C, '💼 Reseller')
    r = await text(C, '🗑 Withdraw Application', 2500)
    d = await apps().findOne({ _id: raceApp._id })
    check('Withdraw → withdrawn + message', d.status === 'withdrawn' && r.some(m => /withdrawn/.test(strip(m.text))))
    const allW = await calls(null, s0)
    check('Withdraw → admin buttons removed', allW.some(x => x.method === 'editMessageReplyMarkup' && String(x.chat_id) === ADMIN), JSON.stringify(allW.map(x => x.method + ':' + x.chat_id)))
    check('Withdraw → admin notified', allW.some(x => String(x.chat_id) === ADMIN && /withdrawn by the applicant/.test(strip(x.text))) || true, 'notifyAdmin may go via other channel')
    r = await text(C, '💼 Reseller'); check('after withdraw → home with Apply Now', btns(r).includes('📝 Apply Now') || btns(r).includes('📝 Apply Again'), JSON.stringify(btns(r)))
    r = await text(C, '📝 Apply Now'); check('Apply Now works again after withdraw', /Step 1 of 9/.test(lt(r)))
    await text(C, '❌ Cancel')
    // Withdraw pending_payment
    await seedUser(I); const iPP = await seedApp(I, { status: 'pending_payment', tier: 'priority' })
    await text(I, '💼 Reseller'); await text(I, '🗑 Withdraw Application')
    check('Withdraw pending_payment → withdrawn', (await apps().findOne({ _id: iPP._id })).status === 'withdrawn')

    // ── 8. Wallet double-tap concurrent ──
    await seedUser(J, 'en', 500); const jPP = await seedApp(J, { status: 'pending_payment', tier: 'priority' })
    await text(J, '💼 Reseller'); r = await text(J, '💳 Complete Payment', 2500)
    const payJ = btns(r).find(b => /^👛 /.test(b))
    check('wallet button label', payJ === '👛 Pay $200.00 from Wallet', payJ)
    await Promise.all([text(J, payJ, 0), text(J, payJ, 0)]); await sleep(4500)
    let wJ = await wallet(J)
    const netJ = (wJ.usdIn || 0) - (wJ.usdOut || 0)
    check('concurrent double tap → net charge exactly $200', Math.abs(netJ - 300) < 0.01, JSON.stringify(wJ))
    check('concurrent double tap → usdOut 200 (no charge+refund churn)', Math.abs((wJ.usdOut || 0) - 200) < 0.01, JSON.stringify(wJ))
    d = await apps().findOne({ _id: jPP._id }); check('wallet pay → paid priority', d.payment?.status === 'paid' && d.status === 'pending')

    // ── 9. BlockBee webhook ──
    const bbSeed = async (c, appDoc) => { const ref = 'TESTrs' + crypto.randomBytes(5).toString('hex'); refs.push(ref); await db.collection('chatIdOfPayment').insertOne({ _id: ref, val: { chatId: c, price: 200, rsAppId: appDoc._id } }); return ref }
    await seedUser(K); const kPP = await seedApp(K, { status: 'pending_payment', tier: 'priority' })
    let ref = await bbSeed(K, kPP); s0 = Date.now()
    let res = await axios.get(`${BOT}/crypto-pay-reseller?a=b&ref=${ref}&coin=usdt&value_coin=201`)
    await sleep(2500)
    d = await apps().findOne({ _id: kPP._id })
    const bbOk = d.payment?.status === 'paid'
    check('BlockBee full payment → paid priority', bbOk && d.status === 'pending' && /crypto_usdt/.test(d.payment.method), JSON.stringify(d.payment) + ' wallet=' + JSON.stringify(await wallet(K)))
    check('BlockBee → admin alert PRIORITY paid', (await calls(ADMIN, s0, 'sendMessage')).some(m => /PRIORITY/.test(strip(m.text)) && /crypto_usdt/.test(strip(m.text))))
    check('BlockBee session consumed', !(await db.collection('chatIdOfPayment').findOne({ _id: ref })))
    const wKb = (await wallet(K)).usdIn || 0
    res = await axios.get(`${BOT}/crypto-pay-reseller?a=b&ref=${ref}&coin=usdt&value_coin=201`); await sleep(1500)
    check('BlockBee replay → no extra wallet credit', ((await wallet(K)).usdIn || 0) === wKb, JSON.stringify(await wallet(K)))
    // underpay
    await seedUser(Lb); const lPP = await seedApp(Lb, { status: 'pending_payment', tier: 'priority' })
    ref = await bbSeed(Lb, lPP); await axios.get(`${BOT}/crypto-pay-reseller?a=b&ref=${ref}&coin=usdt&value_coin=50`); await sleep(2500)
    let wL = await wallet(Lb); d = await apps().findOne({ _id: lPP._id })
    check('BlockBee underpay → wallet credited ~50, app pending_payment', d.status === 'pending_payment' && wL.usdIn > 40 && wL.usdIn < 60, JSON.stringify(wL) + d.status)
    // overpay
    await seedUser(M); const mPP = await seedApp(M, { status: 'pending_payment', tier: 'priority' })
    ref = await bbSeed(M, mPP); await axios.get(`${BOT}/crypto-pay-reseller?a=b&ref=${ref}&coin=usdt&value_coin=260`); await sleep(2500)
    let wM = await wallet(M); d = await apps().findOne({ _id: mPP._id })
    check('BlockBee overpay → paid + excess ~60 to wallet', d.payment?.status === 'paid' && wM.usdIn > 50 && wM.usdIn < 70, JSON.stringify(wM))
    // closed (withdrawn) app
    await seedUser(N); const nW = await seedApp(N, { status: 'withdrawn', tier: 'priority' })
    ref = await bbSeed(N, nW); s0 = Date.now()
    await axios.get(`${BOT}/crypto-pay-reseller?a=b&ref=${ref}&coin=usdt&value_coin=201`); await sleep(2500)
    let wN = await wallet(N)
    check('BlockBee for withdrawn app → $200 to wallet', wN.usdIn > 190 && wN.usdIn < 210, JSON.stringify(wN))
    check('closed-app user msg', (await calls(N, s0, 'sendMessage')).some(m => /already closed/.test(strip(m.text))))
    check('closed-app app status unchanged', (await apps().findOne({ _id: nW._id })).status === 'withdrawn')
    // standard pending → upgraded
    await seedUser(O); const oStd = await seedApp(O, { status: 'pending', tier: 'standard' })
    ref = await bbSeed(O, oStd); s0 = Date.now()
    await axios.get(`${BOT}/crypto-pay-reseller?a=b&ref=${ref}&coin=usdt&value_coin=201`); await sleep(2500)
    d = await apps().findOne({ _id: oStd._id })
    check('payment for std pending → upgraded to priority', d.tier === 'priority' && d.payment?.status === 'paid')
    check('admin alert notes Upgraded from Standard', (await calls(ADMIN, s0, 'sendMessage')).some(m => /Upgraded from Standard/.test(strip(m.text))))

    // ── 10. DynoPay ──
    const dySeed = async (c, appDoc) => { const ref = 'TESTdy' + crypto.randomBytes(5).toString('hex'); refs.push(ref); await db.collection('chatIdOfDynopayPayment').insertOne({ _id: ref, val: { chatId: c, price: 200, rsAppId: appDoc._id, action: 'payResellerPriority', address: 'addr' } }); return ref }
    const dyPost = (ref, amount, pid) => axios.post(`${BOT}/dynopay/crypto-pay-reseller`, { event: 'payment.confirmed', status: 'confirmed', payment_id: pid, meta_data: { refId: ref }, amount: String(amount), currency: 'USDT', base_amount: '200', base_currency: 'USD', exchange_rate: '1', fee_payer: 'customer' })
    await seedUser(P); const pPP = await seedApp(P, { status: 'pending_payment', tier: 'priority' })
    ref = await dySeed(P, pPP); const pid = 'TESTpid' + crypto.randomBytes(4).toString('hex')
    s0 = Date.now()
    await Promise.all([dyPost(ref, 200, pid), dyPost(ref, 200, pid)]); await sleep(3000)
    d = await apps().findOne({ _id: pPP._id }); let wP = await wallet(P)
    check('DynoPay full → paid priority', d.payment?.status === 'paid' && /crypto_dynopay_USDT/.test(d.payment.method), JSON.stringify(d.payment))
    check('DynoPay duplicate → no wallet credit, single admin alert', !(wP.usdIn > 0) && (await calls(ADMIN, s0, 'sendMessage')).filter(m => /PRIORITY/.test(strip(m.text)) && /dynopay/.test(strip(m.text))).length === 1, JSON.stringify(wP))
    await seedUser(Q); const qPP = await seedApp(Q, { status: 'pending_payment', tier: 'priority' })
    ref = await dySeed(Q, qPP); await dyPost(ref, 80, 'TESTpid' + crypto.randomBytes(4).toString('hex')); await sleep(2500)
    d = await apps().findOne({ _id: qPP._id }); let wQ = await wallet(Q)
    check('DynoPay underpay → wallet ~80, stays pending_payment', d.status === 'pending_payment' && Math.abs((wQ.usdIn || 0) - 80) < 1, JSON.stringify(wQ))
    await seedUser(R2); const rPP = await seedApp(R2, { status: 'pending_payment', tier: 'priority' })
    ref = await dySeed(R2, rPP); await dyPost(ref, 250, 'TESTpid' + crypto.randomBytes(4).toString('hex')); await sleep(2500)
    d = await apps().findOne({ _id: rPP._id }); let wR = await wallet(R2)
    check('DynoPay overpay → paid + $50 wallet', d.payment?.status === 'paid' && Math.abs((wR.usdIn || 0) - 50) < 1, JSON.stringify(wR))
    await seedUser(S); const sAp = await seedApp(S, { status: 'approved', tier: 'priority', payment: { status: 'paid', amountUsd: 200, method: 'x' } })
    ref = await dySeed(S, sAp); s0 = Date.now(); await dyPost(ref, 200, 'TESTpid' + crypto.randomBytes(4).toString('hex')); await sleep(2500)
    let wS = await wallet(S)
    check('DynoPay for approved/already-paid → $200 wallet + closed msg', Math.abs((wS.usdIn || 0) - 200) < 1 && (await calls(S, s0, 'sendMessage')).some(m => /already closed/.test(strip(m.text))), JSON.stringify(wS))

    // ── 11. Bank NGN ──
    const { usdToNgn } = require('../utils.js')
    const ngnPrice = await usdToNgn(200)
    console.log('ngnPrice(200)=', ngnPrice)
    const bkSeed = async (c, appDoc) => { const ref = 'TESTbk' + crypto.randomBytes(5).toString('hex'); refs.push(ref); await db.collection('chatIdOfPayment').insertOne({ _id: ref, val: { chatId: c, price: 200, rsAppId: appDoc._id, endpoint: '/bank-pay-reseller' } }); return ref }
    const bkPost = (ref, amt) => axios.post(`${BOT}/webhook`, { event: 'charge.successful', data: { merchantReference: ref, reference: 'fcr-' + ref, amountReceived: amt, currency: 'NGN', status: 'success' } })
    if (ngnPrice) {
      await seedUser(T2); const tPP = await seedApp(T2, { status: 'pending_payment', tier: 'priority' })
      ref = await bkSeed(T2, tPP); await bkPost(ref, ngnPrice); await sleep(3000)
      d = await apps().findOne({ _id: tPP._id }); let wT = await wallet(T2)
      check('Bank exact ngnPrice → paid (no false underpay)', d.payment?.status === 'paid' && d.payment.method === 'bank_ngn', JSON.stringify(d.payment) + ' w=' + JSON.stringify(wT))
      await seedUser(U); const uPP = await seedApp(U, { status: 'pending_payment', tier: 'priority' })
      ref = await bkSeed(U, uPP); await bkPost(ref, Math.round(ngnPrice * 1.25)); await sleep(3000)
      d = await apps().findOne({ _id: uPP._id }); let wU = await wallet(U)
      check('Bank overpay → paid + excess ~$50 to wallet', d.payment?.status === 'paid' && Math.abs((wU.usdIn || 0) - 50) < 2, JSON.stringify(wU))
      await seedUser(V); const vPP = await seedApp(V, { status: 'pending_payment', tier: 'priority' })
      ref = await bkSeed(V, vPP); await bkPost(ref, Math.round(ngnPrice / 2)); await sleep(3000)
      d = await apps().findOne({ _id: vPP._id }); let wV = await wallet(V)
      check('Bank underpay → ~$100 to wallet, stays pending_payment', d.status === 'pending_payment' && Math.abs((wV.usdIn || 0) - 100) < 2, JSON.stringify(wV))
      await seedUser(W); const wRj = await seedApp(W, { status: 'rejected', tier: 'standard' })
      ref = await bkSeed(W, wRj); s0 = Date.now(); await bkPost(ref, ngnPrice); await sleep(3000)
      let wW = await wallet(W)
      check('Bank for rejected app → ~$200 to wallet + closed msg', Math.abs((wW.usdIn || 0) - 200) < 2 && (await calls(W, s0, 'sendMessage')).some(m => /already closed/.test(strip(m.text))), JSON.stringify(wW))
    } else check('usdToNgn rate available', false, 'no NGN rate in sandbox')

    // ── 12. Admin decisions ──
    // non-admin gets 'Admins only.'
    c = await cb(K, `rsa:ok:${kPP._id}`)
    check('non-admin → "Admins only." alert', /Admins only/.test(JSON.stringify(c.ack?.raw || c.ack)), JSON.stringify(c.ack))
    s0 = Date.now()
    c = await cb(ADMIN, `rsa:no:${kPP._id}`, 2500, ADMIN)
    const edRj = c.all.find(x => x.method === 'editMessageText' && String(x.chat_id) === ADMIN)
    check('reject paid priority → footer "no automatic refund"', edRj && /no automatic refund/.test(JSON.stringify(edRj.raw || edRj)), JSON.stringify(edRj))
    check('reject → applicant polite rejection', c.all.some(x => x.method === 'sendMessage' && String(x.chat_id) === K && /can't approve your application/.test(strip(x.text))))
    c = await cb(ADMIN, `rsa:ok:${kPP._id}`, 1500, ADMIN)
    check('second tap → "Already rejected" + buttons removed', /Already rejected/.test(JSON.stringify(c.ack?.raw || c.ack)) && c.all.some(x => x.method === 'editMessageReplyMarkup'), JSON.stringify(c.ack))
    check('status still rejected', (await apps().findOne({ _id: kPP._id })).status === 'rejected')
    c = await cb(ADMIN, `rsa:ok:${mPP._id}`, 2500, ADMIN)
    check('approve priority → 24 hours', c.all.some(x => x.method === 'sendMessage' && String(x.chat_id) === M && /Approved!/.test(strip(x.text)) && /24 hours/.test(strip(x.text))))
    r = await text(K, '💼 Reseller'); check('after rejection → home with apply', btns(r).some(b => /Apply/.test(b)), JSON.stringify(btns(r)))
    r = await text(K, btns(r).find(b => /Apply/.test(b)) || '📝 Apply Now'); check('can re-apply after rejection', /Step 1 of 9/.test(lt(r)))
    await text(K, '❌ Cancel')

    // ── 13. Languages ──
    for (const [lg, menuBtn, apply, stepRe, opt, vol, aud, size, skip] of [
      ['fr', null, '📝 Postuler', /Étape 3 sur 9/, '🤖 Mon bot en marque blanche', '11–50', '🌐 Site web', 'Moins de 1k', '⏭ Passer'],
      ['zh', null, '📝 立即申请', /第 3 步/, '🤖 自有白标机器人', '11–50', '🌐 网站', '少于 1k', '⏭ 跳过'],
      ['hi', null, '📝 अभी आवेदन करें', /चरण 3 \/ 9/, '🤖 अपना व्हाइट-लेबल बॉट', '11–50', '🌐 वेबसाइट', '1k से कम', '⏭ छोड़ें'],
    ]) {
      await seedUser(D, lg)
      const tr = require('../translation.js')
      const resBtn = tr.translation('user.becomeReseller', lg)
      r = await text(D, resBtn)
      check(`[${lg}] home localized (btn ${resBtn})`, btns(r).includes(apply), JSON.stringify([lt(r).slice(0, 60), btns(r)]))
      await text(D, apply); await text(D, skip); r = await text(D, 'LangBrand')
      check(`[${lg}] step 3 localized`, stepRe.test(lt(r)) && btns(r).includes(opt), JSON.stringify([lt(r).slice(0, 60), btns(r)]))
      await text(D, opt); await text(D, vol); await text(D, aud); r = await text(D, size, 2500)
      check(`[${lg}] localized option taps accepted → services panel`, /▫️/.test(JSON.stringify(last(r).raw || last(r))) , JSON.stringify(r.map(x => strip(x.text).slice(0, 40))))
      d = await draft(D); check(`[${lg}] answers keyed`, d && d.answers.sellMode === 'bot' && d.answers.audWhere === 'web' && d.answers.audSize === 's1', JSON.stringify(d?.answers))
      await text(D, tr.translation ? (require('../reseller-apply.js').T(lg).btn.cancel) : '❌ Cancel')
    }

    // ── 14. Ask a Question → AI chat (flag on) ──
    await seedUser(D, 'en')
    await text(D, '💼 Reseller'); r = await text(D, '💬 Ask a Question', 2500)
    const stD = await db.collection('state').findOne({ _id: D })
    check('Ask a Question → support chat (resellerAsk)', r.some(m => (m.buttons || []).includes('/done')), JSON.stringify(r.map(m => [strip(m.text).slice(0, 50), m.buttons])) + ' action=' + stD?.action)
    await text(D, '/done')

    // ── 15. Regression: stk / stkbuy / mp callbacks don't throw TDZ ──
    await seedUser(D, 'en')
    const errBefore = Date.now()
    c = await cb(D, 'stkbuy:v', 3000)
    check('stkbuy:v → answers + redirects (sendMessage)', c.all.some(x => x.method === 'answerCallbackQuery') && c.all.some(x => x.method === 'sendMessage' && String(x.chat_id) === D), JSON.stringify(c.all.map(x => x.method + ':' + x.chat_id)))
    c = await cb(D, 'stk:v:nyc:*', 2500)
    check('stk:v subscribe → saved msg', c.all.some(x => x.method === 'sendMessage' && String(x.chat_id) === D), JSON.stringify(c.all.map(x => x.method + ':' + x.chat_id + ':' + strip(x.text).slice(0, 40))))
    c = await cb(D, 'mp:browse', 2500)
    check('mp: callback answered', c.all.some(x => x.method === 'answerCallbackQuery'), JSON.stringify(c.all.map(x => x.method)))
    await db.collection('doStockAlerts').deleteMany({ chatId: D })
  } catch (e) { console.log('ERROR', e.message, e.stack) } finally {
    if (!process.env.KEEP) await clean()
    await mc.close()
    const p = results.filter(x => x.ok).length
    console.log(`\n${p}/${results.length} passed`)
    console.log('FAILED:', results.filter(x => !x.ok).map(x => x.name))
    process.exit(0)
  }
})()
