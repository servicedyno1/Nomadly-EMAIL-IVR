#!/usr/bin/env node
// Extended retest (iteration_111): 💼 Reseller form escape (note step, fr/zh/hi labels, /cancel + /start on services),
// BlockBee /crypto-pay-reseller tolerance (resolveCryptoCreditUsd), conversion failure, upgrade-from-standard clears old
// admin buttons, alertResellerApplication retry + fallback (needs mock /_fail injection).
// Run: node js/tests/test_reseller_apply_escape_ext_2026-10.js
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const crypto = require('crypto')
const { MongoClient } = require('mongodb')
const BOT = 'http://localhost:5000'
const WEBHOOK = BOT + '/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const ADMIN = String(process.env.TELEGRAM_ADMIN_CHAT_ID)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
const tr = require('../translation.js')
const RA = require('../reseller-apply.js')
let uid = 9_700_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' :: ' + String(detail).slice(0, 500) : ''}`) }
const calls = async (chat, since, method) => (await axios.get(`${MOCK}/_calls?${chat ? 'chat_id=' + chat + '&' : ''}since=${since}${method ? '&method=' + method : ''}`)).data
async function text(chat, t, wait = 1800) {
  const since = Date.now(); const n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat }, text: t } }, { timeout: 20000 })
  await sleep(wait)
  return (await calls(chat, since)).filter(c => c.method === 'sendMessage')
}
async function cb(chat, data, mid, wait = 1500) {
  const since = Date.now(); const n = uid++
  await axios.post(WEBHOOK, { update_id: n, callback_query: { id: String(n), from: { id: Number(chat), is_bot: false, first_name: 'Sim' }, message: { message_id: mid, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' } }, data } }, { timeout: 20000 })
  await sleep(wait)
  return calls(null, since)
}
const USERS = Array.from({ length: 20 }, (_, i) => String(990400070 + i))
let db
const apps = () => db.collection('resellerApplications')
const latest = c => apps().findOne({ chatId: c }, { sort: { updatedAt: -1 } })
const wallet = async c => (await db.collection('walletOf').findOne({ _id: c })) || {}
async function seedUser(c, lang = 'en') {
  await db.collection('state').deleteOne({ _id: c }); await db.collection('walletOf').deleteOne({ _id: c }); await apps().deleteMany({ chatId: c })
  await db.collection('state').insertOne({ _id: c, userLanguage: lang, action: 'none' })
}
async function seedApp(c, over = {}) {
  const now = new Date()
  const doc = { _id: crypto.randomUUID(), chatId: c, username: 'sim' + c, lang: 'en', status: 'pending_payment', idx: 9, tier: 'priority', answers: { email: null, brand: 'ExtBrand' + c.slice(-2), sellMode: 'bot', volume: 'v2', audWhere: 'tg', audSize: 's2', services: ['ivr'], note: null }, createdAt: now, updatedAt: now, submittedAt: now, ...over }
  await apps().insertOne(doc); return doc
}
const refs = []
const bbSeed = async (c, appDoc) => { const ref = 'TESTrx' + crypto.randomBytes(5).toString('hex'); refs.push(ref); await db.collection('chatIdOfPayment').insertOne({ _id: ref, val: { chatId: c, price: 200, rsAppId: appDoc._id } }); return ref }
const bbPay = (ref, v, coin = 'usdt') => axios.get(`${BOT}/crypto-pay-reseller?a=b&ref=${ref}&coin=${coin}&value_coin=${v}`, { timeout: 30000 })
// Walk en/fr/zh/hi form up to the services panel
async function toServices(c, lg = 'en') {
  const t = RA.T(lg)
  await text(c, tr.translation('user.becomeReseller', lg)); await text(c, t.btn.apply); await text(c, t.btn.skip); await text(c, 'ExtBrand')
  await text(c, Object.values(t.opt.sellMode)[0]); await text(c, Object.values(t.opt.volume)[0]); await text(c, Object.values(t.opt.audWhere)[0])
  return text(c, Object.values(t.opt.audSize)[0], 2500)
}

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  db = mc.db(process.env.DB_NAME)
  const clean = async () => {
    for (const c of ['state', 'walletOf', 'nameOf']) await db.collection(c).deleteMany({ _id: { $in: USERS } })
    await apps().deleteMany({ chatId: { $in: USERS } })
    await db.collection('chatIdOfPayment').deleteMany({ _id: { $in: refs } })
    await db.collection('payments').deleteMany({ _id: { $in: refs } })
  }
  try {
    await clean()
    const [A, B, C, D, E, F, G, H, I, J, K] = USERS

    // ── 1. Note-step escape (en) with 🏠 Main Menu and 👛 Wallet ──
    for (const esc of ['🏠 Main Menu', '👛 Wallet']) {
      await seedUser(A)
      await toServices(A); const dr0 = await apps().findOne({ chatId: A, status: 'draft' })
      await cb(A, 'rsa:t:sms', dr0.panelMsgId); await cb(A, 'rsa:c', dr0.panelMsgId, 2200)
      let d = await apps().findOne({ chatId: A, status: 'draft' })
      check(`[note:${esc}] reached note step (idx 7)`, d?.idx === 7, d?.idx)
      const r = await text(A, esc, 2500)
      d = await latest(A); const st = await db.collection('state').findOne({ _id: A })
      check(`[note:${esc}] draft cancelled left_form, label not saved as note, action≠rsApply`, d.status === 'cancelled' && d.cancelReason === 'left_form' && d.answers.note !== esc && st.action !== 'rsApply', JSON.stringify({ s: d.status, cr: d.cancelReason, note: d.answers.note, a: st.action }))
      const ok = esc === '👛 Wallet' ? r.some(m => /Wallet|Balance/i.test(strip(m.text))) : r.some(m => (m.buttons || []).includes('👛 Wallet'))
      check(`[note:${esc}] target menu shown`, ok && !r.some(m => /Step 9 of 9/.test(strip(m.text))), JSON.stringify(r.map(m => strip(m.text).slice(0, 60))))
    }

    // ── 2. fr/zh/hi menu-label escape on brand step (wallet label + main-menu label) ──
    for (const lg of ['fr', 'zh', 'hi']) {
      const t = RA.T(lg)
      for (const esc of [tr.translation('user.wallet', lg), t.btn.menu]) {
        await seedUser(B, lg)
        await text(B, tr.translation('user.becomeReseller', lg)); await text(B, t.btn.apply); await text(B, t.btn.skip)
        const r = await text(B, esc, 2500)
        const d = await latest(B); const st = await db.collection('state').findOne({ _id: B })
        check(`[${lg}] "${esc}" on brand step → cancelled left_form, not saved`, d.status === 'cancelled' && d.cancelReason === 'left_form' && d.answers.brand !== esc && st.action !== 'rsApply', JSON.stringify({ s: d.status, b: d.answers.brand, a: st.action, r: r.map(m => strip(m.text).slice(0, 50)) }))
        check(`[${lg}] "${esc}" → a non-form reply was shown`, r.length > 0 && !r.some(m => /3/.test(strip(m.text).slice(0, 25)) && (m.buttons || []).includes(t.btn.cancel)), JSON.stringify(r.map(m => [strip(m.text).slice(0, 50), m.buttons])))
      }
    }

    // ── 3. /cancel on services step → "Application cancelled" + panel cleared; fr ❌ Annuler on services ──
    for (const [lg, cmd] of [['en', '/cancel'], ['fr', RA.T('fr').btn.cancel], ['zh', RA.T('zh').btn.cancel], ['hi', RA.T('hi').btn.cancel]]) {
      await seedUser(C, lg); await toServices(C, lg)
      const dr = await apps().findOne({ chatId: C, status: 'draft' }); const pmid = dr?.panelMsgId
      const s = Date.now(); const r = await text(C, cmd, 2500)
      const all = await calls(C, s)
      const d = await latest(C); const st = await db.collection('state').findOne({ _id: C })
      check(`[${lg}] ${cmd} on services → cancelled msg + status cancelled (not left_form)`, r.some(m => strip(m.text).includes(strip(RA.T(lg).cancelled).slice(0, 15))) && d.status === 'cancelled' && d.cancelReason !== 'left_form' && st.action === 'none', JSON.stringify({ s: d.status, cr: d.cancelReason, a: st.action, r: r.map(m => strip(m.text).slice(0, 50)) }))
      check(`[${lg}] ${cmd} on services → panel ${pmid} buttons removed`, !!pmid && all.some(x => x.method === 'editMessageReplyMarkup' && String(x.raw?.message_id) === String(pmid)), JSON.stringify(all.map(x => x.method)))
    }

    // ── 4. /start on services step → cancelled + panel cleared + stale continue tap closed ──
    await seedUser(D); await toServices(D)
    let dr = await apps().findOne({ chatId: D, status: 'draft' }); const pD = dr?.panelMsgId
    let s = Date.now(); await text(D, '/start', 3000)
    let all = await calls(D, s); let d = await apps().findOne({ _id: dr._id })
    check('/start on services → cancelled left_form + panel cleared', d.status === 'cancelled' && d.cancelReason === 'left_form' && all.some(x => x.method === 'editMessageReplyMarkup' && String(x.raw?.message_id) === String(pD)), JSON.stringify({ s: d.status, m: all.map(x => x.method) }))
    all = await cb(D, 'rsa:c', pD)
    check('stale rsa:c after /start → "This step is closed." + buttons removed', /This step is closed/.test(JSON.stringify(all.filter(x => x.method === 'answerCallbackQuery'))) && all.some(x => x.method === 'editMessageReplyMarkup' && String(x.raw?.message_id) === String(pD)), JSON.stringify(all.map(x => x.method)))

    // ── 5. form's own buttons still work on free-text steps (Back/Skip not escapes) ──
    await seedUser(E); await text(E, '💼 Reseller'); await text(E, '📝 Apply Now')
    let r = await text(E, '⏭ Skip'); check('Skip on email → step 2', /Step 2 of 9/.test(strip(r.slice(-1)[0]?.text)))
    r = await text(E, '⬅️ Back'); check('Back on brand → step 1 (not escape)', /Step 1 of 9/.test(strip(r.slice(-1)[0]?.text)) && !!(await apps().findOne({ chatId: E, status: 'draft' })))
    await text(E, '❌ Cancel')

    // ── 6. BlockBee tolerance ──
    await seedUser(F); const fA = await seedApp(F); let ref = await bbSeed(F, fA); s = Date.now()
    await bbPay(ref, 200); await sleep(3000)
    d = await apps().findOne({ _id: fA._id }); let w = await wallet(F)
    check('BlockBee 200 USDT (~$199.8) → paid priority, no wallet credit', d.payment?.status === 'paid' && d.status === 'pending' && !(w.usdIn > 0), JSON.stringify({ p: d.payment, w }))
    let adm = await calls(ADMIN, s, 'sendMessage')
    check('BlockBee 200 → admin PRIORITY alert, no UNDERPAYMENT alert', adm.some(m => /PRIORITY/.test(strip(m.text)) && /crypto_usdt/.test(strip(m.text))) && !adm.some(m => /UNDERPAYMENT/.test(strip(m.text)) && m.text.includes(F)), JSON.stringify(adm.map(m => strip(m.text).slice(0, 60))))

    await seedUser(G); const gA = await seedApp(G); ref = await bbSeed(G, gA)
    await bbPay(ref, 185); await sleep(3000)
    d = await apps().findOne({ _id: gA._id }); w = await wallet(G)
    check('BlockBee 185 USDT (≥90%) → paid, no wallet credit', d.payment?.status === 'paid' && !(w.usdIn > 0), JSON.stringify({ p: d.payment, w }))

    await seedUser(H); const hA = await seedApp(H); ref = await bbSeed(H, hA); s = Date.now()
    await bbPay(ref, 150); await sleep(3000)
    d = await apps().findOne({ _id: hA._id }); w = await wallet(H)
    check('BlockBee 150 USDT (<90%) → pending_payment + wallet ≈ $149.85', d.status === 'pending_payment' && !d.payment && w.usdIn > 145 && w.usdIn < 151, JSON.stringify({ s: d.status, w }))
    adm = await calls(ADMIN, s, 'sendMessage')
    check('BlockBee 150 → admin UNDERPAYMENT alert, no PRIORITY card', adm.some(m => /UNDERPAYMENT/.test(strip(m.text))) && !adm.some(m => /Reseller Application/.test(strip(m.text)) && m.text.includes(hA.answers.brand)), JSON.stringify(adm.map(m => strip(m.text).slice(0, 60))))

    await seedUser(I); const iA = await seedApp(I); ref = await bbSeed(I, iA)
    await bbPay(ref, 260); await sleep(3000)
    d = await apps().findOne({ _id: iA._id }); w = await wallet(I)
    check('BlockBee 260 → paid + excess ≈ $59.7 to wallet', d.payment?.status === 'paid' && w.usdIn > 55 && w.usdIn < 62, JSON.stringify(w))

    // conversion failure (unknown ticker → convert() throws/null)
    await seedUser(J); const jA = await seedApp(J); ref = await bbSeed(J, jA); s = Date.now()
    await bbPay(ref, 200, 'zzznotacoin'); await sleep(4000)
    d = await apps().findOne({ _id: jA._id }); w = await wallet(J)
    adm = await calls(ADMIN, s, 'sendMessage')
    check('BlockBee convert failure → no "$null", invoice fallback (paid)', d.payment?.status === 'paid' && !(w.usdIn === null) && !adm.some(m => /\$null/.test(m.text || '')), JSON.stringify({ p: d.payment, w }))
    check('BlockBee convert failure → admin "could not price" note', adm.some(m => /CryptoCredit/.test(m.text || '') && /could not price/.test(m.text || '')), JSON.stringify(adm.map(m => strip(m.text).slice(0, 80))))

    // ── 7. Upgrade-from-standard clears old admin buttons ──
    await seedUser(K); const kA = await seedApp(K, { status: 'pending', tier: 'standard', adminMsg: { chatId: ADMIN, messageId: 4242421 } })
    ref = await bbSeed(K, kA); s = Date.now()
    await bbPay(ref, 201); await sleep(3000)
    all = await calls(ADMIN, s)
    const iEdit = all.findIndex(x => x.method === 'editMessageReplyMarkup' && String(x.raw?.message_id) === '4242421')
    const iNew = all.findIndex(x => x.method === 'sendMessage' && /Upgraded from Standard/.test(strip(x.text)))
    check('upgrade → old admin card (4242421) buttons removed', iEdit >= 0, JSON.stringify(all.map(x => x.method + ':' + (x.raw?.message_id || ''))))
    check('upgrade → old buttons removed BEFORE new alert sent', iEdit >= 0 && iNew > iEdit, `edit=${iEdit} new=${iNew}`)
    d = await apps().findOne({ _id: kA._id })
    check('upgrade → adminMsg now points to new card', d.tier === 'priority' && d.adminMsg && d.adminMsg.messageId !== 4242421, JSON.stringify(d.adminMsg))

    // ── 8. alertResellerApplication retry + fallback (mock /_fail injection) ──
    const hasFail = await axios.post(`${MOCK}/_fail?method=sendMessage&match=__probe__&count=0`).then(() => true).catch(() => false)
    if (!hasFail) check('mock supports /_fail injection', false, 'restart mock_telegram_api.js')
    else {
      // 2 failures → delivered on attempt 3
      await seedUser(E); const eA = await seedApp(E, { answers: { brand: 'RetryBrandOK', services: ['ivr'] } })
      await axios.post(`${MOCK}/_fail?method=sendMessage&match=RetryBrandOK&count=2`)
      ref = await bbSeed(E, eA); s = Date.now()
      await bbPay(ref, 201); await sleep(9000)
      adm = await calls(ADMIN, s, 'sendMessage')
      const tries = adm.filter(m => /RetryBrandOK/.test(m.text || ''))
      check('retry: 2 injected failures → 3 attempts, card delivered, no fallback', tries.length === 3 && (await apps().findOne({ _id: eA._id })).adminMsg && !adm.some(m => /Could not deliver the application card/.test(m.text || '')), `attempts=${tries.length} gaps=${tries.map((x, i) => i ? x.ts - tries[i - 1].ts : 0)}`)
      check('retry: backoff ≈2s then ≈4s', tries.length === 3 && tries[1].ts - tries[0].ts >= 1800 && tries[2].ts - tries[1].ts >= 3800, JSON.stringify(tries.map(x => x.ts)))
      // 3 failures → fallback notifyAdmin
      await seedUser(F); const fB = await seedApp(F, { answers: { brand: 'RetryBrandKO', services: ['ivr'] } })
      await axios.post(`${MOCK}/_fail?method=sendMessage&match=RetryBrandKO&count=3`)
      ref = await bbSeed(F, fB); s = Date.now()
      await bbPay(ref, 201); await sleep(10000)
      adm = await calls(ADMIN, s, 'sendMessage')
      const fb = adm.find(m => /Could not deliver the application card/.test(m.text || ''))
      check('fallback: 3 failures → "🚨 [Reseller] Could not deliver the application card" (PAID)', !!fb && /PAID/.test(fb.text) && fb.text.includes(String(fB._id).slice(0, 8)), JSON.stringify(adm.map(m => strip(m.text).slice(0, 80))))
      check('fallback: app still paid priority (money not lost)', (await apps().findOne({ _id: fB._id })).payment?.status === 'paid')
    }
  } catch (e) { console.log('ERROR', e.message, e.stack) } finally {
    if (!process.env.KEEP) await clean()
    await mc.close()
    const p = results.filter(x => x.ok).length
    console.log(`\n${p}/${results.length} passed`)
    console.log('FAILED:', results.filter(x => !x.ok).map(x => x.name))
    process.exit(0)
  }
})()
