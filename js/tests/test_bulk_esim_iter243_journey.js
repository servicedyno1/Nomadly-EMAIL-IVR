// iter243: shorter 4-step journey over the live webhook (:5000) — number check (simulated: last4 9900–9949 landline, 9950+ VoIP),
// billing for all uploaded numbers, price type auto-detected, AI rotation keeping/swapping links (2 real Claude calls), own '---' versions,
// opt-out toggle, when-screen (replies toggle, send now, schedule −10%), wallet pay, fr/zh/hi/fa labels, copy checks.
// Run from /app: node js/tests/test_bulk_esim_iter243_journey.js
require('dotenv').config({ path: '/app/backend/.env' })
process.env.WEB_CLOUDIVR_DRY_RUN = 'true'; process.env.BULK_ESIM_WORKER = 'false'; process.env.BULK_ESIM_FAKE_CREDIT = '500'
delete process.env.BULK_ESIM_LOOKUP_LIVE
const axios = require('axios'), { MongoClient } = require('mongodb'), B = require('../bulk-esim/core'), BOT = require('../bulk-esim/bot'), I = require('../bulk-esim/i18n')
const CHAT = 990000444, sleep = (ms) => new Promise(r => setTimeout(r, ms))
let n = 0, pass = 0, fail = 0
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`) }
const tg = async (text, wait = 1900) => { await axios.post('http://localhost:5000/telegram/webhook', { update_id: Date.now() + (++n), message: { message_id: 4000 + n, from: { id: CHAT, is_bot: false, first_name: 'Qa' }, chat: { id: CHAT, type: 'private' }, date: Math.floor(Date.now() / 1000), text } }); await sleep(wait) }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  await B.init({ db, log: () => {} })
  const cid = B.cidOf(BOT.brand(), CHAT), had = await db.collection('bsConfig').findOne({ _id: 'settings' })
  await B.setConfig({ quietStart: 0, quietEnd: 24, monitorEsims: 0, testerEsims: 0, scheduleDiscountPct: 10, numberCheck: true }, 'qa-iter243')
  if ((await db.collection('bsEsims').countDocuments({ status: 'available', role: 'service' })) < 3) { for (let i = 0; i < 4; i++) await B.provisionOne('qa'); await B.healthCheck() }
  const st = async () => (await db.collection('state').findOne({ _id: String(CHAT) })) || {}
  const setLang = (l) => db.collection('state').updateOne({ _id: String(CHAT) }, { $set: { userLanguage: l, action: 'none' } }, { upsert: true })
  await setLang('en'); await db.collection('walletOf').updateOne({ _id: String(CHAT) }, { $set: { usdIn: 300, usdOut: 0 } }, { upsert: true })
  const nums = (from, k) => Array.from({ length: k }, (_, i) => `+1212555${String(from + i).padStart(4, '0')}`)
  const walk = async (label, steps) => { let all = true; for (const [text, want, wait] of steps) { await tg(text, wait); const a = (await st()).action; if (a !== want) all = false; ok(`${label}: ${JSON.stringify(String(text).slice(0, 30))} → ${want}`, a === want, a) } return all }
  const L = I.btn('en'), HOME = L.home

  try {
    // ---------- Copy checks (rendered from i18n) ----------
    const ha = { min: 500, max: 2000, plain: 50, link: 75, pct: 10, minHours: 24, fee: 20, used: 0, limit: 2000, from: 8, to: 21 }
    const homeEn = I.t('en', 'home', ha)
    ok('copy: en home (short) mentions every US & Canadian carrier + free first test', /every US & Canadian carrier/.test(homeEn) && /First test SMS free/.test(homeEn), homeEn.slice(0, 120))
    for (const l of ['fr', 'zh', 'hi', 'fa']) { const h = I.t(l, 'home', ha); ok(`copy: ${l} short home shows $50/$75 and today's usage`, /50/.test(h) && /75/.test(h) && /2,000/.test(h) && h.split('\n').length <= 8, h.slice(0, 80)) }
    const lo = I.t('en', 'list_ok', { n: 520, max: 2000, dropped: 0, send: 500, skipped: 20, counts: { landline: 10, voip: 10, invalid: 0, other: 0 }, invalid: 0, duplicates: 0, optedOut: 0 })
    ok('copy: consent summary shows 520 numbers, 500 mobiles, skipped breakdown, "You pay for all 520"', lo.includes('<b>520</b> numbers') && lo.includes('<b>500</b> will get your text') && /20 skipped/.test(lo) && /landline/.test(lo) && /VoIP/.test(lo) && lo.includes('Billed for all 520'), lo.replace(/\n/g, ' | ').slice(0, 260))

    // ---------- Price-type auto-detect (direct) ----------
    ok('detect: link text → withLinks', B.checkContent('Sale at shop.example.com').withLinks === true)
    ok('detect: phone text → withLinks', B.checkContent('Call (212) 555-0199 now').withLinks === true)
    ok('detect: plain text → text only', B.checkContent('Spring sale 20% off all plans this week').withLinks === false)
    const dateTxt = B.checkContent('Offer valid 2026-01-15 to 2026-01-31 only'), typoTxt = B.checkContent('Big sale today.Come in and save')
    ok('detect (edge): a date like 2026-01-15 is NOT a phone (text only)', dateTxt.withLinks === false, `withLinks=${dateTxt.withLinks}`)
    ok('detect (edge): "today.Come" counts as a link (strict, user-approved — no price dodging)', typoTxt.withLinks === true, `withLinks=${typoTxt.withLinks}`)

    // ---------- Run A: link text, 500 mobiles + 10 landline + 10 VoIP, send one, replies toggle, send now, wallet ----------
    const listA = [...nums(4000, 500), ...nums(9900, 10), ...nums(9950, 10)]
    await walk('A', [[HOME, 'bse-home'], [L.newc, 'bse-contacts'], [listA.join('\n'), 'bse-consent', 3000]])
    const dA = await db.collection('bsDrafts').findOne({ _id: cid })
    ok('A draft: 520 contacts stored, 20 skipped (10 landline 9900+, 10 VoIP 9950+)', dA?.contacts?.length === 520 && dA.skip?.length === 20 && dA.skip.every(p => Number(p.slice(-4)) >= 9900), JSON.stringify([dA?.contacts?.length, dA?.skip?.length]))
    await walk('A', [['yes', 'bse-consent'], [L.agree, 'bse-content'], ['a'.repeat(139), 'bse-content'], ['Sale at shop.example.com today only', 'bse-review'], [L.use_one, 'bse-test', 2600]])
    const sA = await st(), cpA = await db.collection('bsCampaigns').findOne({ _id: sA.bseCampaign })
    ok('A campaign: volume 520 billed, 500 to text, 20 skipped, link type auto, opt-out on', cpA?.volume === 520 && cpA.parts === 520 && cpA.contacts.length === 500 && cpA.skipped.length === 20 && cpA.stats.skipped === 20 && cpA.withLinks === true && cpA.optOut === true, JSON.stringify(cpA && [cpA.volume, cpA.parts, cpA.contacts.length, cpA.skipped.length, cpA.withLinks, cpA.optOut]))
    await walk('A', [[L.cont, 'bse-when'], [L.replies_add(20), 'bse-when']])
    ok('A replies ON after toggle', (await db.collection('bsCampaigns').findOne({ _id: sA.bseCampaign }))?.replies === true)
    const wo = await B.whenOptions(cid, sA.bseCampaign)
    ok('A when price includes +$20 (78+20=98 now)', wo?.now ? wo.now.price === 98 : true, JSON.stringify(wo?.now))
    await walk('A', [[L.replies_off, 'bse-when']])
    ok('A replies OFF after remove', (await db.collection('bsCampaigns').findOne({ _id: sA.bseCampaign }))?.replies === false)
    await tg(L.now, 2600); let aA = (await st()).action
    if (aA === 'bse-when') { const w = await B.whenOptions(cid, sA.bseCampaign); if (w.later) { console.log('   (send now gone → later today)'); await tg(`${L.later} ${String(w.later.hour).padStart(2, '0')}:00`, 2600); aA = (await st()).action } }
    ok('A: 🚀 Send now → bse-pay', aA === 'bse-pay', aA)
    const bA = await db.collection('bsBookings').findOne({ _id: (await st()).bseBookingId })
    ok('A booking: 520 SMS, $78 (link $75/500 × 520), no reply fee', bA?.volume === 520 && bA.price === 78 && bA.replyFee === 0, JSON.stringify(bA && [bA.volume, bA.price, bA.replyFee, bA.mode]))
    await walk('A', [[L.wallet, 'bse-home', 3500]])
    const wA = await db.collection('walletOf').findOne({ _id: String(CHAT) }), qA = await db.collection('bsMessages').find({ bookingId: bA?._id }).toArray()
    ok('A wallet debited $78', wA?.usdOut === 78, String(wA?.usdOut))
    const skipSet = new Set(cpA?.skipped || [])
    ok('A queued exactly 500 messages, none to landline/VoIP', qA.length === 500 && !qA.some(m => skipSet.has(m.to)), `${qA.length} queued, ${qA.filter(m => skipSet.has(m.to)).length} to skipped`)
    ok('A queued body keeps link + opt-out line', qA[0]?.body === 'Sale at shop.example.com today only\nReply STOP to opt out', JSON.stringify(qA[0]?.body))
    const rA = await B.report(cpA._id)
    ok('A progress report shows 20 skipped', rA.skipped === 20 && rA.total === 500, JSON.stringify(rA))
    ok('A progress line renders "20 skipped (not mobile)"', I.t('en', 'progress_line', 'x', 'sending', rA).includes('20 skipped (not mobile)'))
    await walk('A', [[L.progress, 'bse-home']])

    // ---------- Run B: link text, AI with customer's other links (1 Claude call) ----------
    const src = 'Spring sale at shop.example.com: 20% off all plans this week.'
    await walk('B', [[L.newc, 'bse-contacts'], [nums(6000, 510).join('\n'), 'bse-consent', 3000], [L.agree, 'bse-content'], [src, 'bse-review'], [L.rotate_ai, 'bse-ai-links']])
    await walk('B', [['visit x.com', 'bse-ai-links'], ['+12125550123', 'bse-ai-links']])
    ok('B: no AI call for bad link lines (no bsAiVariants yet)', (await db.collection('bsAiVariants').countDocuments({ cid })) === 0)
    // the keyboard shown after the phone-number error offers ✅ Send this one message — does it work in bse-ai-links?
    await tg(L.use_one, 2600); const aUse = (await st()).action
    ok('B: "✅ Send this one message" offered after swap error works (leaves bse-ai-links)', aUse === 'bse-test', aUse)
    if (aUse === 'bse-test') { await walk('B redo', [[HOME, 'bse-home'], [L.newc, 'bse-contacts'], [nums(6000, 510).join('\n'), 'bse-consent', 3000], [L.agree, 'bse-content'], [src, 'bse-review'], [L.rotate_ai, 'bse-ai-links']]) }
    await walk('B', [['deals.example.org\npromo.example.net', 'bse-variants-pick', 40000]])
    const sB = await st(), vB = sB.bseVarShown || []
    console.log('   B variants:', JSON.stringify(vB))
    ok('B: AI variants returned, each has exactly one of the new links, none keeps shop.example.com', vB.length >= 1 && vB.every(v => (v.includes('deals.example.org') ^ v.includes('promo.example.net')) && !v.includes('shop.example.com')), String(vB.length))
    ok('B: links rotated across versions (both used when ≥2 variants)', vB.length < 2 || (vB.some(v => v.includes('deals.example.org')) && vB.some(v => v.includes('promo.example.net'))))
    ok('B: every variant fits one SMS with opt-out', vB.every(v => !B.checkContent(v, true, true).error))
    await walk('B', [[L.use_all, 'bse-test', 2600]])
    const cpB = await db.collection('bsCampaigns').findOne({ _id: (await st()).bseCampaign })
    ok('B campaign: original + all variants, link type', cpB?.content?.length === 1 + vB.length && cpB.content[0] === src && cpB.withLinks === true, JSON.stringify(cpB?.content?.length))

    // ---------- Run C: AI keeps the same link (1 Claude call) ----------
    await walk('C', [[HOME, 'bse-home'], [L.newc, 'bse-contacts'], [nums(6000, 510).join('\n'), 'bse-consent', 3000], [L.agree, 'bse-content'], [src, 'bse-review'], [L.rotate_ai, 'bse-ai-links'], [L.same_links, 'bse-variants-pick', 40000]])
    const vC = (await st()).bseVarShown || []
    console.log('   C variants:', JSON.stringify(vC))
    ok('C: AI variants keep original link exactly, no other link', vC.length >= 1 && vC.every(v => v.includes('shop.example.com') && !/deals\.example|promo\.example/.test(v)), String(vC.length))
    await walk('C', [[L.keep, 'bse-test', 2600]])
    const cpC = await db.collection('bsCampaigns').findOne({ _id: (await st()).bseCampaign })
    ok('C: "keep" with none picked → only the original text', cpC?.content?.length === 1, JSON.stringify(cpC?.content))

    // ---------- Run D: opt-out toggle, own '---' versions with different links/numbers, schedule −10%, pay ----------
    const d2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    await walk('D', [[HOME, 'bse-home'], [L.newc, 'bse-contacts'], [nums(6000, 510).join('\n'), 'bse-consent', 3000], [L.agree, 'bse-content'],
      ['b'.repeat(139), 'bse-content'], ['b'.repeat(138), 'bse-review'], [L.edit, 'bse-content'], [L.optout_no, 'bse-content'], ['b'.repeat(161), 'bse-content'], ['b'.repeat(160), 'bse-review']])
    ok('D: opt-out off saved', (await st()).bseOptOut === false)
    const own = 'Shop at a.example.com today\n---\nCall +1 212 555 0101 for deals\n---\nNew deals at b.example.com'
    await walk('D', [[L.rotate_own, 'bse-content'], [own, 'bse-review']])
    ok('D: review holds 3 own versions', (await st()).bseContent?.length === 3, JSON.stringify((await st()).bseContent))
    await walk('D', [[L.use_these, 'bse-test', 2600], [L.cont, 'bse-when'], [L.sched, 'bse-day'], [d2, 'bse-hour', 2600], ['12:00 · x free', 'bse-pay', 2600]])
    const sD = await st(), cpD = await db.collection('bsCampaigns').findOne({ _id: sD.bseCampaign }), bD = await db.collection('bsBookings').findOne({ _id: sD.bseBookingId })
    ok('D campaign: 3 versions, link type, opt-out off', cpD?.content?.length === 3 && cpD.withLinks === true && cpD.optOut === false, JSON.stringify(cpD && [cpD.content.length, cpD.withLinks, cpD.optOut]))
    ok('D booking scheduled −10%: list 76.5 → 68.85', bD?.mode === 'scheduled' && bD.listPrice === 76.5 && bD.price === 68.85 && bD.discountPct === 10, JSON.stringify(bD && [bD.mode, bD.listPrice, bD.price, bD.discountPct]))
    await walk('D', [[L.wallet, 'bse-home', 3500]])
    const wD = await db.collection('walletOf').findOne({ _id: String(CHAT) }), bD2 = await db.collection('bsBookings').findOne({ _id: bD?._id })
    ok('D paid from wallet (out 78+68.85=146.85)', Math.abs((wD?.usdOut || 0) - 146.85) < 0.001 && bD2?.paymentStatus === 'paid', JSON.stringify([wD?.usdOut, bD2?.status, bD2?.paymentStatus]))

    // ---------- Run E: fr/zh/hi/fa labels through the journey ----------
    for (const lang of ['fr', 'zh', 'hi', 'fa']) {
      await setLang(lang); const K = I.btn(lang)
      const good = await walk(`E-${lang}`, [[K.home, 'bse-home'], [K.newc, 'bse-contacts'], [[...nums(7000, 505), ...nums(9910, 3), ...nums(9960, 2)].join('\n'), 'bse-consent', 3000], [K.agree, 'bse-content'],
        [K.optout_no, 'bse-content'], [K.optout_yes, 'bse-content'], ['Spring sale call 212-555-0188', 'bse-review'], [K.rotate_own, 'bse-content'], ['Sale v1 at a.example.com\n---\nSale v2 at b.example.com', 'bse-review'],
        [K.use_these, 'bse-test', 2600], [K.cont, 'bse-when'], [K.replies_add(20), 'bse-when'], [K.replies_off, 'bse-when'], [K.sched, 'bse-day'], [K.back, 'bse-home']])
      const cp = await db.collection('bsCampaigns').findOne({ _id: (await st()).bseCampaign })
      ok(`E-${lang}: campaign 510 billed / 505 texted / 5 skipped, 2 versions, link type`, good && cp?.volume === 510 && cp.contacts.length === 505 && cp.skipped.length === 5 && cp.content.length === 2 && cp.withLinks === true, JSON.stringify(cp && [cp.volume, cp.contacts.length, cp.skipped.length, cp.content.length]))
    }
    await setLang('en'); await tg(HOME)
  } catch (e) { fail++; console.log('❌ exception', e.message) }

  console.log(`\n${pass} passed, ${fail} failed`)
  // cleanup: only this chat's data + restore settings
  const bks = (await db.collection('bsBookings').find({ cid }).toArray()).map(b => b._id)
  await db.collection('bsMessages').deleteMany({ $or: [{ cid }, { bookingId: { $in: bks } }] })
  console.log('cleanup', (await db.collection('bsBookings').deleteMany({ cid })).deletedCount, (await db.collection('bsCampaigns').deleteMany({ cid })).deletedCount)
  for (const c of ['bsDaily', 'bsPayments', 'bsNotify', 'bsAiVariants', 'bsSessions', 'bsDemand', 'bsDrafts', 'bsLookupLog']) await db.collection(c).deleteMany({ $or: [{ cid }, { _id: cid }, { _id: new RegExp(`^${cid}:`) }, { chatId: String(CHAT) }] })
  await db.collection('bsCustomers').deleteOne({ _id: cid }); await db.collection('walletOf').deleteOne({ _id: String(CHAT) }); await db.collection('state').deleteOne({ _id: String(CHAT) })
  if (had) await db.collection('bsConfig').replaceOne({ _id: 'settings' }, had); else await db.collection('bsConfig').deleteOne({ _id: 'settings' })
  await cl.close(); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e.message); process.exit(1) })
