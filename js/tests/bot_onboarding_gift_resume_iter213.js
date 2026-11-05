#!/usr/bin/env node
// iter213: new-user onboarding (products-first, $5 gift on first tap), Farsi pick, and auto-complete-after-deposit
// against the REAL bot via mock Telegram API (:5099). Requires: mock_telegram_api.js running and the bot started with
// TELEGRAM_API_BASE_URL=http://127.0.0.1:5099 on :5000.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const N1 = '990213101', N2 = '990213102', FA = '990213103', R = '990213110', SHORT = '990213111', OLD = '990213112', EX = '990213113'
const INC = '990213114'
const BOT_LOG = process.env.BOT_LOG || '/tmp/bot.log'
const ALL = [N1, N2, FA, R, SHORT, OLD, EX, INC]
let uid = 7_000_000 + Math.floor(Math.random() * 100000)
const results = []
const check = (name, ok, d = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok ? ' :: ' + String(d).slice(0, 700) : ''}`) }
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
const calls = async (chat, since) => (await axios.get(`${MOCK}/_calls?${new URLSearchParams({ chat_id: chat, since: String(since) })}`)).data
async function say(chat, text, wait = 3000) {
  const since = Date.now(), n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat }, text } }, { timeout: 15000 })
  await sleep(wait)
  return calls(chat, since)
}
const txt = cs => cs.filter(c => c.method === 'sendMessage').map(c => strip(c.text)).join('\n---\n')
const btns = cs => cs.flatMap(c => c.buttons || [])
const MENU = '👛 Wallet'

;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  const db = mc.db(process.env.DB_NAME)
  const cleanup = async () => {
    for (const c of ['state', 'walletOf', 'nameOf', 'chatIdOf', 'userConversion']) await db.collection(c).deleteMany({ _id: { $in: ALL } })
    await db.collection('userConversion').deleteMany({ chatId: { $in: ALL } })
    await db.collection('welcomeBonuses').deleteMany({ chatId: { $in: ALL } })
    await db.collection('resumableSessions').deleteMany({ _id: { $in: ALL.map(c => 'resume_' + c) } })
    await db.collection('transactions').deleteMany({ chatId: { $in: ALL } })
    await db.collection('domainsOf').deleteMany({ _id: { $in: ALL } }).catch(() => {})
    await db.collection('chatIdOfPayment').deleteMany({ _id: /^iter213/ })
    await db.collection('payments').deleteMany({ _id: /^iter213/ })
  }
  const bal = async id => { const w = await db.collection('walletOf').findOne({ _id: id }); return w ? (w.usdIn || 0) - (w.usdOut || 0) : null }
  const st = id => db.collection('state').findOne({ _id: id })
  await cleanup()
  try {
    // ── 1. New user /start → language menu → English → teaser + main menu, nothing credited ──
    let cs = await say(N1, '/start')
    check('1a./start shows 5 languages incl Farsi', JSON.stringify(btns(cs)) === JSON.stringify(['🇬🇧 English', '🇫🇷 French', '🇨🇳 Chinese', '🇮🇳 Hindi', '🇮🇷 فارسی (Persian)']), JSON.stringify(btns(cs)))
    cs = await say(N1, '🇬🇧 English', 3500)
    check('1b.gift teaser sent', /A \$5 welcome gift is waiting for you/.test(txt(cs)), txt(cs))
    check('1c.main menu shown (Select an option below + 👛 Wallet)', /Select an option below/.test(txt(cs)) && btns(cs).includes(MENU), txt(cs))
    check('1d.no email question / intent picker', !/Add your email|What do you need today/i.test(txt(cs)), txt(cs))
    let s = await st(N1)
    check('1e.welcomeGiftPending true, not credited', s?.welcomeGiftPending === true && !(await bal(N1)) && !(await db.collection('welcomeBonuses').findOne({ chatId: N1 })), JSON.stringify({ p: s?.welcomeGiftPending, b: await bal(N1) }))
    // non-triggering taps
    for (const m of ['↩️ Back', '🏠 Main Menu', 'Cancel', '🇬🇧 English', 'hi', 'hello I want a domain', '↩️ Retour', '❌ Annuler', '取消', 'रद्द करें', 'بازگشت', '⚙️ Settings', '💬 Support', '➕ More']) await say(N1, m, 1500)
    check('1f.Back/Main Menu/Cancel/lang/free text/localized nav/Settings/Support/More do NOT credit gift', !(await bal(N1)) && (await st(N1)).welcomeGiftPending === true, await bal(N1))
    await say(N1, '↩️ Back', 1500)
    cs = await say(N1, MENU, 3500)
    check('1g.first real tap → Welcome Gift message', /Welcome Gift/.test(txt(cs)) && /\$5 has been added/.test(txt(cs)), txt(cs))
    check('1h.wallet shows $5 after tap', /\$5\.00/.test(txt(cs)) && (await bal(N1)) === 5, await bal(N1))
    cs = await say(N1, '↩️ Back', 2000); cs = await say(N1, MENU, 3000)
    check('1i.second tap no extra credit', (await bal(N1)) === 5 && !/Welcome Gift/.test(txt(cs)) && (await db.collection('welcomeBonuses').countDocuments({ chatId: N1 })) === 1 && (await db.collection('transactions').countDocuments({ chatId: N1, type: 'welcome-bonus' })) === 1, await bal(N1))

    // ── 2. Second new user: Cloud IVR tap triggers the gift ──
    await say(N2, '/start', 2000); await say(N2, '🇬🇧 English', 3500)
    cs = await say(N2, '📞 Cloud IVR + SIP', 4000)
    check('2a.Cloud IVR first tap → gift + IVR hub', /Welcome Gift/.test(txt(cs)) && /Cloud IVR/.test(txt(cs)) && btns(cs).includes('🛒 Choose a Plan'), txt(cs).slice(0, 500) + JSON.stringify(btns(cs)))
    check('2b.N2 wallet $5', (await bal(N2)) === 5, await bal(N2))
    // returning /start for a brand-new user (products-first: should be the main menu, not the intent picker)
    cs = await say(N2, '/start', 3500)
    check('2c.returning /start (new user) → main menu, no intent picker', /Select an option below/.test(txt(cs)) && !/What do you need today/.test(txt(cs)), txt(cs).slice(0, 400) + JSON.stringify(btns(cs)))
    cs = await say(N2, '/start', 3500)
    check('2d.second returning /start → main menu', /Select an option below/.test(txt(cs)), txt(cs).slice(0, 300))

    // ── 3. Existing user (no welcomeGiftPending) unaffected ──
    await db.collection('state').insertOne({ _id: EX, userLanguage: 'en', action: 'none', firstSessionIntentDone: true })
    await db.collection('walletOf').insertOne({ _id: EX, usdIn: 0, usdOut: 0 })
    cs = await say(EX, '/start', 3000)
    check('3a.existing user /start → main menu', /Select an option below/.test(txt(cs)) && btns(cs).includes(MENU), txt(cs).slice(0, 300))
    cs = await say(EX, MENU, 3000)
    check('3b.existing user tap → no gift', !/Welcome Gift/.test(txt(cs)) && (await bal(EX)) === 0, await bal(EX))

    // ── 4. Farsi (translated bot strings) ──
    const { translation: tr } = require('../translation.js')
    const faMenu = tr('o', 'fa').reply_markup.keyboard.flat().map(b => b.text || b)
    const FA_WALLET = faMenu.find(b => b.startsWith('👛')), FA_IVR = faMenu.find(b => b.startsWith('📞')), FA_SET = faMenu.find(b => b.startsWith('⚙️'))
    await say(FA, '/start', 2000)
    cs = await say(FA, '🇮🇷 فارسی (Persian)', 3500)
    s = await st(FA)
    check('4a.Farsi saved userLanguage fa', s?.userLanguage === 'fa', s?.userLanguage)
    check('4b.Farsi → Persian teaser + Persian main menu', /هدیه/.test(txt(cs)) && btns(cs).includes(FA_WALLET), txt(cs) + JSON.stringify(btns(cs)))
    cs = await say(FA, FA_WALLET, 3000)
    check('4c.Farsi Wallet works (+gift in Persian)', (await bal(FA)) === 5 && /هدیه خوش‌آمدگویی/.test(txt(cs)), txt(cs))
    const faBack = btns(cs).find(b => /بازگشت|Back/.test(b))
    cs = await say(FA, faBack || '↩️ Back', 2500)
    check('4d.Farsi Back → Persian main menu', btns(cs).includes(FA_WALLET), txt(cs) + JSON.stringify(btns(cs)))
    cs = await say(FA, FA_IVR, 3500)
    check('4e.Farsi Cloud IVR hub opens', btns(cs).length > 2 && !btns(cs).includes(FA_WALLET), JSON.stringify(btns(cs)))
    cs = await say(FA, '/start', 2500); cs = await say(FA, FA_SET, 2500)
    const faLang = btns(cs).find(b => b.startsWith('🌍') && b !== FA_SET)
    cs = await say(FA, faLang, 2500)
    check('4f.Change Language lists Farsi', btns(cs).includes('🇮🇷 فارسی (Persian)'), JSON.stringify(btns(cs)))
    cs = await say(FA, '🇬🇧 English', 2500)
    check('4g.switch fa → en', (await st(FA)).userLanguage === 'en', (await st(FA)).userLanguage)

    // ── 5. Auto-complete after deposit (real domain flow → balance wall → Deposit $X → crypto webhook) ──
    const domainFlowToWall = async (id, dom) => {
      await db.collection('state').insertOne({ _id: id, userLanguage: 'en', action: 'none', firstSessionIntentDone: true })
      await db.collection('walletOf').insertOne({ _id: id, usdIn: 0, usdOut: 0 })
      await say(id, '🌐 Bulletproof Domains', 2000)
      await say(id, '🛒🌐 Buy Domain Names', 2000)
      await say(id, dom, 15000)
      let c = await say(id, '❌ No', 5000)
      const dep = btns(c).find(b => /^💵 Deposit \$/.test(b))
      c = await say(id, dep, 3000)
      return { dep, c }
    }
    const price = async id => (await db.collection('resumableSessions').findOne({ _id: 'resume_' + id }))?.data?.price
    const deposit = async (id, usd) => {
      const ref = 'iter213' + id + Date.now()
      await db.collection('chatIdOfPayment').updateOne({ _id: ref }, { $set: { val: { chatId: id } } }, { upsert: true })
      const since = Date.now()
      const r = await axios.get(`http://localhost:5000/crypto-wallet?ref=${ref}&coin=trc20_usdt&value_coin=${usd}`, { timeout: 30000 }).catch(e => e.response)
      await sleep(20000)
      return { r, cs: await calls(id, since) }
    }
    // Section 5 runs ONLY when the domain dry-run guard is active (non-production) — no registrar/Cloudflare call is made.
    if (!require('../domain-dry-run').isDomainDryRun()) console.log('SKIP section 5 — domain dry run is OFF (production env); refusing to register a real domain')
    else {
    const dom1 = `iter213auto${Date.now() % 100000}.com`
    let { dep } = await domainFlowToWall(R, dom1)
    const p1 = await price(R)
    check('5a.balance wall → Deposit button + resumable session saved', !!dep && p1 > 0 && (await db.collection('resumableSessions').findOne({ _id: 'resume_' + R }))?.step === 'domain-pay', JSON.stringify({ dep, p1 }))
    let { r, cs: dcs } = await deposit(R, p1 + 1)  // USDT→USD conversion shaves a few cents; overpay by $1
    console.log('INFO deposit status', r?.status, 'bal', await bal(R))
    check('5b."Payment received — completing your order now…" sent', /Payment received — completing your order now/.test(txt(dcs)), txt(dcs))
    check('5c.no manual "Complete My Order" offer button', !btns(dcs).includes('✅ Complete My Order'), JSON.stringify(btns(dcs)))
    // registration (dry-run provider) can take ~30s after the synthesized Yes
    const depSince = Date.now() - 25000
    let w
    for (let i = 0; i < 20; i++) { w = await db.collection('walletOf').findOne({ _id: R }); if ((w.usdOut || 0) > 0) break; await sleep(3000) }
    await sleep(8000)
    w = await db.collection('walletOf').findOne({ _id: R })
    const all = txt(await calls(R, depSince))
    console.log('INFO R wallet', JSON.stringify(w), '\nINFO R msgs:\n' + all.slice(0, 2500))
    check('5d.order charged once (<= quoted price; registrar may charge less)', (w.usdOut || 0) > 0 && (w.usdOut || 0) <= p1 + 0.01, JSON.stringify(w))
    check('5e.session cleared', !(await db.collection('resumableSessions').findOne({ _id: 'resume_' + R })))
    check('5f.domain confirmation exactly once', (all.match(/is now yours/g) || []).length === 1, all.slice(0, 800))

    }
    // ── 6. Still short → old behaviour, no auto-complete ──
    await db.collection('state').insertOne({ _id: SHORT, userLanguage: 'en', action: 'none', firstSessionIntentDone: true })
    await db.collection('walletOf').insertOne({ _id: SHORT, usdIn: 0, usdOut: 0 })
    await db.collection('resumableSessions').insertOne({ _id: 'resume_' + SHORT, chatId: SHORT, flowType: 'domain-purchase', step: 'domain-pay', data: { price: 42, coin: 'usd', label: 'x.com' }, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 864e5) })
    ;({ cs: dcs } = await deposit(SHORT, 20))
    check('6a.short deposit → no auto-complete, no charge', !/completing your order/.test(txt(dcs)) && !((await db.collection('walletOf').findOne({ _id: SHORT })).usdOut > 0), txt(dcs))
    check('6b.session kept', !!(await db.collection('resumableSessions').findOne({ _id: 'resume_' + SHORT })))
    // a deposit landing a little short tells the user how much is missing
    await db.collection('walletOf').updateOne({ _id: SHORT }, { $set: { usdIn: 0, usdOut: 0 } })
    // the separate $5 first-deposit bonus (>= $20 deposit) would push $40.96 over the $42 order — mark it already used
    await db.collection('userConversion').updateOne({ chatId: SHORT }, { $set: { chatId: SHORT, firstDepositBonusAwarded: true } }, { upsert: true })
    ;({ cs: dcs } = await deposit(SHORT, 41))
    check('6c.slightly short deposit → "you are $X short" notice, no charge', /short of your/.test(txt(dcs)) && !/completing your order/.test(txt(dcs)) && !((await db.collection('walletOf').findOne({ _id: SHORT })).usdOut > 0), txt(dcs))

    // ── 7. Old session (>6h) → one-tap offer, no auto-complete ──
    await db.collection('state').insertOne({ _id: OLD, userLanguage: 'en', action: 'none', firstSessionIntentDone: true })
    await db.collection('walletOf').insertOne({ _id: OLD, usdIn: 0, usdOut: 0 })
    const old = new Date(Date.now() - 7 * 3600e3)
    await db.collection('resumableSessions').insertOne({ _id: 'resume_' + OLD, chatId: OLD, flowType: 'domain-purchase', step: 'domain-pay', data: { price: 42, coin: 'usd', label: 'old.com' }, createdAt: old, updatedAt: old, expiresAt: new Date(Date.now() + 864e5) })
    ;({ cs: dcs } = await deposit(OLD, 50))
    check('7a.old session → offer with Complete My Order + Start Fresh', btns(dcs).includes('✅ Complete My Order') && btns(dcs).includes('🆕 Start Fresh') && !/completing your order now/.test(txt(dcs)), txt(dcs) + JSON.stringify(btns(dcs)))
    check('7b.old session not charged', !((await db.collection('walletOf').findOne({ _id: OLD })).usdOut > 0))

    // ── 8. iter215: fresh session with incomplete order data {price,coin,label} → stop at confirm, no 'Some Issue' ──
    await db.collection('state').insertOne({ _id: INC, userLanguage: 'en', action: 'none', firstSessionIntentDone: true })
    await db.collection('walletOf').insertOne({ _id: INC, usdIn: 0, usdOut: 0 })
    await db.collection('userConversion').updateOne({ chatId: INC }, { $set: { chatId: INC, firstDepositBonusAwarded: true } }, { upsert: true })
    await db.collection('resumableSessions').insertOne({ _id: 'resume_' + INC, chatId: INC, flowType: 'domain-purchase', step: 'domain-pay', data: { price: 42, coin: 'usd', label: 'inc.com' }, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 864e5) })
    const logOff = require('fs').statSync(BOT_LOG).size
    ;({ cs: dcs } = await deposit(INC, 50))
    await sleep(3000)
    const incLog = (() => { const fd = require('fs').openSync(BOT_LOG, 'r'); const len = require('fs').statSync(BOT_LOG).size - logOff; const b = Buffer.alloc(Math.max(0, len)); require('fs').readSync(fd, b, 0, b.length, logOff); require('fs').closeSync(fd); return b.toString() })()
    console.log('INFO INC msgs:\n' + txt(dcs).slice(0, 1200) + '\nINFO INC log:\n' + incLog.split('\n').filter(l => l.includes(INC)).join('\n').slice(0, 1500))
    check('8a.incomplete session → no "Some Issue"', !/Some Issue/i.test(txt(dcs)), txt(dcs))
    check('8b.iter216: "couldn\'t reopen that order — your $X is safe" shown, no $0.00 confirm', /couldn't reopen that order/.test(txt(dcs)) && /safe in your wallet/.test(txt(dcs)) && !/\$0\.00/.test(txt(dcs)), txt(dcs))
    check('8b2.main menu keyboard shown after reopen-failure', btns(dcs).includes(MENU), JSON.stringify(btns(dcs)))
    check('8c.incomplete session not charged', !((await db.collection('walletOf').findOne({ _id: INC })).usdOut > 0))
    check('8d.iter216: NOT left at confirm screen (action != walletSelectCurrencyConfirm)', (await st(INC))?.action !== 'walletSelectCurrencyConfirm', (await st(INC))?.action)
  } catch (e) {
    check('script error', false, e.stack)
  } finally {
    await cleanup()
    await mc.close()
    const p = results.filter(r => r.ok).length
    console.log(`\nRESULT ${p}/${results.length} passed`)
    process.exit(0)
  }
})()
