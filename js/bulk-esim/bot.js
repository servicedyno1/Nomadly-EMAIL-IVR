'use strict'
// Telegram side of eSIM BulkSMS (USA/Canada): 4-step campaign wizard (numbers + free number check + consent → message, price type
// detected, optional rotation → optional test → when + replies → pay), one-off texts, conversations with reply, usage, bookings, progress, help. Every rule lives in core.js.
// Each bot delivers its own customers' notices (bsNotify) and wallet refunds. Texts: ./i18n.js (en, fr, zh, hi, fa).
const axios = require('axios')
const B = require('./core')
const { walletOps } = require('../cloudivr-web/wallet')
const { saveUpload } = require('./storage')
const { t, btn, allLabels } = require('./i18n')

const PRODUCT_KEY = 'bulk-esim-sms'
const BTN = btn('en')
const kb = (rows) => ({ parse_mode: 'HTML', reply_markup: { keyboard: rows, resize_keyboard: true } })
const homeKb = (L) => kb([[L.newc], [L.one, L.convs], [L.usage, L.bookings], [L.progress, L.help], [L.back]])
const brand = () => (process.env.CHAT_BOT_BRAND || 'Nomadly').replace(/[^A-Za-z0-9]/g, '')
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const per500 = (x) => Math.round(x * 500 * 100) / 100
const errText = (lang, r) => t(lang, r.error, ...(r.args || []))
const OLD_HOME = ['🛰 eSIM BulkSMS (USA/Canada)', '🛰 eSIM SMS en masse (USA/Canada)', '🛰 eSIM 群发短信（美国/加拿大）', '🛰 eSIM बल्क SMS (USA/कनाडा)', '🛰 پیامک انبوه eSIM (آمریکا/کانادا)'] // labels still on older keyboards
const isHome = (m) => m === '/esimsms' || allLabels('home').includes(m) || OLD_HOME.includes(m)
let T = null
const drafts = () => B.db().collection('bsDrafts')

async function homeArgs(cid) {
  const c = await B.cfg(), u = await B.usage(cid)
  return { min: c.minVolume, max: c.maxVolume, plain: per500(c.pricePlain), link: per500(c.priceLink), pct: c.scheduleDiscountPct, minHours: c.scheduleMinHours, fee: c.replyFee, perDay: c.testsPerDay, used: u.used, limit: u.limit, from: c.quietStart, to: c.quietEnd }
}
const home = async (send, chatId, lang) => send(chatId, t(lang, 'home', await homeArgs(B.cidOf(brand(), chatId))), homeKb(btn(lang)))
const days = () => Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400000).toISOString().slice(0, 10))

// Returns true when the message was handled here (anything but an explicit false).
const handle = async (ctx) => (await flow(ctx)) !== false
async function flow({ chatId, msg, message, info, set, state, send, saveInfo, goto, bot }) {
  const action = info?.action || '', lang = info?.userLanguage || 'en', L = btn(lang), say = (k, ...a) => t(lang, k, ...a)
  const cid = B.cidOf(brand(), chatId), go = (a) => set(state, chatId, 'action', a), put = (k, v) => saveInfo(k, v), HK = homeKb(L)
  if (isHome(message) && !B.configured()) { await send(chatId, say('soon')); return true }
  if (isHome(message)) {
    await B.customer(brand(), chatId); await go('bse-home')
    if (!info?.bseIntroAt) { const c = await B.cfg(); await send(chatId, say('intro', { minHours: c.scheduleMinHours, pct: c.scheduleDiscountPct })); await put('bseIntroAt', new Date().toISOString()) }
    await home(send, chatId, lang); return true
  }
  if (!action.startsWith('bse-')) return false
  if (message === L.back) { if (action === 'bse-home') { await go('none'); return goto.submenu7 ? (await goto.submenu7(), true) : false } await go('bse-home'); await home(send, chatId, lang); return true }
  if (action === 'bse-home') {
    if (message === L.newc) { const c = await B.cfg(); await go('bse-contacts'); return send(chatId, say('contacts_q', { min: c.minVolume, max: c.maxVolume }), kb([[L.back]])) }
    if (message === L.one) { await go('bse-one-to'); return send(chatId, say('one_to_q'), kb([[L.back]])) }
    if (message === L.usage) { const u = await B.usage(cid); return send(chatId, say('usage', { ...u, reset: u.resetAt.toISOString().slice(0, 16).replace('T', ' ') }), HK) }
    if (message === L.help) return send(chatId, say('help', await homeArgs(cid)), HK)
    if (message === L.convs) {
      const ss = await B.db().collection('bsSessions').find({ cid, status: 'active' }).sort({ lastActivityAt: -1 }).limit(10).toArray()
      if (!ss.length) return send(chatId, say('conv_none'), HK)
      await go('bse-conv'); return send(chatId, say('conv_pick'), kb([...ss.map(s => [`💬 ${s.to}`]), [L.back]]))
    }
    if (message === L.bookings) {
      const bs = await B.db().collection('bsBookings').find({ cid }).sort({ createdAt: -1 }).limit(10).toArray()
      const txt = bs.length ? bs.map(b => `• <code>${b._id.slice(-6)}</code> ${b.date} ${String(b.hour).padStart(2, '0')}:00 UTC · ${b.volume} SMS · $${b.price} · <b>${say(`st_${b.status}`)}</b>${b.refundedUnsent ? ` · ↩️ $${b.refundedUnsent}` : ''}`).join('\n') : say('bookings_none')
      return send(chatId, `${say('bookings_title')}\n${txt}`, kb([...(bs.some(b => ['awaiting_payment', 'scheduled', 'confirmed', 'provisioning'].includes(b.status)) ? [[L.cancelBk]] : []), [L.back]]))
    }
    if (message === L.cancelBk) { await go('bse-cancel'); return send(chatId, say('cancel_q'), kb([[L.back]])) }
    if (message === L.progress) {
      const cps = await B.db().collection('bsCampaigns').find({ cid, status: { $ne: 'draft' } }).sort({ createdAt: -1 }).limit(5).toArray()
      if (!cps.length) return send(chatId, say('progress_none'), HK)
      const lines = []; for (const cp of cps) lines.push(say('progress_line', esc(cp.name), say(`st_${cp.status}`), await B.report(cp._id)))
      return send(chatId, `${lines.join('\n\n')}\n\n${say('progress_note')}`, HK)
    }
    return home(send, chatId, lang)
  }
  if (action === 'bse-cancel') { const b = await B.db().collection('bsBookings').findOne({ cid, _id: new RegExp(`${String(message).trim().replace(/\W/g, '')}$`) }); const r = b ? await B.cancelBooking(b._id, { cid }) : { error: 'err_not_found' }; await go('bse-home'); return send(chatId, r.error ? `⚠️ ${errText(lang, r)}` : say('cancelled', r.refunded), HK) }
  const testKb = () => kb([[L.test], [L.cont], [L.back]])
  const unitOf = (c, links) => (links ? c.priceLink : c.pricePlain)
  const contentAsk = async (key = 'content_q') => { const c = await B.cfg(), optOut = info.bseOptOut !== false; return send(chatId, say(key, { max: optOut ? 160 - B.OPT.length : 160, optOut, plain: per500(c.pricePlain), link: per500(c.priceLink) }), kb([[optOut ? L.optout_no : L.optout_yes], [L.back]])) }
  // Step 1 — numbers: parsed, capped at maxVolume, checked (Telnyx carrier lookup, free); every kept number is billed, only mobiles are texted.
  if (action === 'bse-contacts') {
    let raw = message, fileName = null
    if (msg?.document) {
      const name = msg.document.file_name || ''
      if (!/\.(txt|csv)$/i.test(name) || (msg.document.file_size || 0) > 2e6) return send(chatId, say('file_bad'))
      try { const link = await bot.getFileLink(msg.document.file_id); raw = String((await axios.get(link, { timeout: 20000, responseType: 'text', maxContentLength: 2e6 })).data) } catch (_) { return send(chatId, say('file_bad')) }
      fileName = name
    }
    const r = await B.parseContacts(cid, raw), c = await B.cfg()
    if (r.contacts.length < c.minVolume) return send(chatId, say('contacts_few', { ...r, n: r.contacts.length, parts: r.contacts.length }, c.minVolume))
    const list = r.contacts.slice(0, c.maxVolume)
    await send(chatId, say('checking', list.length))
    const k = await B.checkNumbers(cid, list)
    if (!k.sendable) return send(chatId, `⚠️ ${say('err_no_mobile')}`)
    await drafts().updateOne({ _id: cid }, { $set: { contacts: list, skip: k.skip, file: fileName ? { name: fileName, raw } : null, at: new Date() } }, { upsert: true })
    await go('bse-consent')
    return send(chatId, say('list_ok', { n: list.length, max: c.maxVolume, dropped: r.contacts.length - list.length, send: k.sendable, skipped: k.skip.length, counts: k.counts, invalid: r.invalid, duplicates: r.duplicates, optedOut: r.optedOut }), kb([[L.agree], [L.back]]))
  }
  if (action === 'bse-consent') {
    if (message !== L.agree) return send(chatId, say('pick_option'))
    await put('bseOptOut', true); info.bseOptOut = true; await go('bse-content'); return contentAsk()
  }
  // Step 2 — message: the price type comes from the text (link/phone → link price); one SMS per version.
  async function review() {
    const c = await B.cfg(), d = await drafts().findOne({ _id: cid }) || {}, v = info.bseContent, links = v.some(B.hasLinkOrPhone), n = (d.contacts || []).length
    await go('bse-review')
    return send(chatId, say('review', { v, found: [...new Set(v.flatMap(B.linksIn))], optOut: info.bseOptOut !== false, links, n, price: Math.round(n * unitOf(c, links) * 100) / 100 }), kb([[v.length > 1 ? L.use_these : L.use_one], [L.rotate_ai], ...(v.length > 1 ? [] : [[L.rotate_own]]), [L.edit], [L.back]]))
  }
  if (action === 'bse-content') {
    if (message === L.optout_no || message === L.optout_yes) { info.bseOptOut = message === L.optout_yes; await put('bseOptOut', info.bseOptOut); return contentAsk() }
    const optOut = info.bseOptOut !== false, k = B.checkContent(message, undefined, optOut)
    if (k.error) return send(chatId, `⚠️ ${errText(lang, k)}`, kb([[optOut ? L.optout_no : L.optout_yes], [L.back]]))
    const sc = await B.screenContent(cid, k.parts); if (sc.error) return send(chatId, errText(lang, sc), kb([[optOut ? L.optout_no : L.optout_yes], [L.back]]))
    await put('bseLinksUnchecked', !!sc.unchecked)
    info.bseContent = k.parts; await put('bseContent', k.parts); await put('bseVarAll', []); await put('bseVarRounds', 0); await put('bseVariants', []); await put('bseSwap', [])
    return review()
  }
  // Rotation with AI: link/number kept exactly — or the customer gives other links/numbers and each version gets one of them.
  async function offerVariants(swap) {
    const rounds = info.bseVarRounds || 0; if (rounds >= 3) return send(chatId, say('variants_max'), kb([[L.use_all], [L.keep], [L.back]]))
    const prev = info.bseVarAll || [], r = await B.aiVariants(cid, { text: info.bseContent[0], optOut: info.bseOptOut !== false, avoid: [...info.bseContent, ...prev], swap: swap ?? info.bseSwap ?? [] })
    if (r.error === 'err_links_bad') return send(chatId, `⚠️ ${errText(lang, r)}`, kb([[L.same_links], [L.use_one], [L.back]]))
    if (r.error) { await go('bse-review'); return send(chatId, `⚠️ ${errText(lang, r)}`, kb([[info.bseContent.length > 1 ? L.use_these : L.use_one], [L.rotate_ai], [L.edit], [L.back]])) }
    await put('bseVarShown', r.variants); await put('bseVarAll', [...prev, ...r.variants]); await put('bseVarRounds', rounds + 1); await go('bse-variants-pick')
    return send(chatId, say('variants_list', r.variants, info.bseOptOut !== false), kb([[L.use_all], [L.more], [L.keep], [L.back]]))
  }
  if (action === 'bse-review') {
    if (message === L.use_one || message === L.use_these) return finalize([])
    if (message === L.edit) { await go('bse-content'); return contentAsk() }
    if (message === L.rotate_own) { await go('bse-content'); return contentAsk('own_q') }
    if (message === L.rotate_ai) {
      if (!B.hasLinkOrPhone(info.bseContent[0])) return offerVariants([])
      await go('bse-ai-links'); return send(chatId, say('ai_links_q'), kb([[L.same_links], [L.use_one], [L.back]]))
    }
    return send(chatId, say('pick_option'))
  }
  if (action === 'bse-ai-links') {
    if (message === L.same_links) { await put('bseSwap', []); return offerVariants([]) }
    if (message === L.use_one || message === L.use_these) return finalize([])
    const alts = String(message).split('\n').map(x => x.trim()).filter(Boolean)
    if (!alts.length || alts.length > 10 || !alts.every(B.onlyLinkOrPhone)) return send(chatId, `⚠️ ${say('err_links_bad')}`, kb([[L.same_links], [L.use_one], [L.back]]))
    const sc = await B.screenContent(cid, alts, 'rotation links'); if (sc.error) return send(chatId, errText(lang, sc), kb([[L.same_links], [L.use_one], [L.back]]))
    if (sc.unchecked) await put('bseLinksUnchecked', true)
    await put('bseSwap', alts); return offerVariants(alts)
  }
  if (action === 'bse-variants-pick') {
    const shown = info.bseVarShown || [], chosen = info.bseVariants || []
    if (message === L.use_all) return finalize([...chosen, ...shown])
    if (message === L.more) { await put('bseVariants', chosen); return offerVariants() }
    if (message === L.keep) return finalize(chosen)
    const nums = [...new Set((String(message).match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= shown.length))]
    if (nums.length && /^[\d\s,.]+$/.test(String(message).trim())) return finalize([...chosen, ...nums.map(n => shown[n - 1])])
    return send(chatId, say('pick_option'))
  }
  // Campaign created from the draft (numbers + message); then Step 3 — optional test.
  async function finalize(variants) {
    const d = await drafts().findOne({ _id: cid }) || {}, f = d.file, content = [...info.bseContent, ...(variants || [])]
    const upload = f ? await saveUpload(B.db(), cid, { name: f.name, data: f.raw }).catch(e => { console.log(`[BulkESIM] upload store: ${e.message}`); return null }) : null
    const cr = await B.createCampaign(cid, { name: content[0].slice(0, 40), content, contacts: d.contacts || [], skip: d.skip || [], linksUnchecked: !!info.bseLinksUnchecked, optOut: info.bseOptOut !== false, consent: true, uploadId: upload?._id })
    if (cr.error) { await go('bse-contacts'); const c = await B.cfg(); return send(chatId, `⚠️ ${errText(lang, cr)}\n\n${say('contacts_q', { min: c.minVolume, max: c.maxVolume })}`, kb([[L.back]])) }
    const cp = cr.campaign, c = await B.cfg(), unit = unitOf(c, cp.withLinks)
    await put('bseCampaign', cp._id); await drafts().deleteOne({ _id: cid }); await go('bse-test')
    const o = await B.testOffer(cid)
    return send(chatId, say('ready', { n: cp.volume, v: cp.content.length, price: Math.round(cp.parts * unit * 100) / 100, unit, tests: c.testSends, free: o.free, perDay: c.testsPerDay }), testKb())
  }
  // Tests go to any USA/Canada number. Never paid for a campaign → one free test, no wallet needed. Otherwise the wallet must cover
  // the campaign (so tests mean "about to buy"), each test is charged at the unit price (refunded when the campaign is paid), quota applies.
  const price = async (cp) => { const c = await B.cfg(); return Math.round((cp.parts * unitOf(c, cp.withLinks) + (cp.replies ? c.replyFee : 0)) * 100) / 100 }
  if (action === 'bse-test') {
    if (message === L.test) {
      const o = await B.testOffer(cid), c = await B.cfg()
      if (!o.free) {
        const cp = await B.db().collection('bsCampaigns').findOne({ _id: info.bseCampaign, cid }), need = cp ? await price(cp) : 0, bal = await walletOps(T.db).balance(chatId).catch(() => 0)
        if (bal < need) return send(chatId, say('test_locked', need, Number(bal).toFixed(2), { firstTime: o.firstTime, perDay: c.testsPerDay }), kb([[L.cont], [L.back]]))
      }
      await go('bse-test-to'); return send(chatId, say('test_to_q', o.free), kb([[L.back]]))
    }
    if (message === L.cont) return askWhen()
    return false
  }
  if (action === 'bse-test-to') {
    const k = await B.testCheck(cid, info.bseCampaign, message); if (k.error) return send(chatId, `⚠️ ${errText(lang, k)}`, kb([[L.cont], [L.back]]))
    const w = walletOps(T.db), c = await B.cfg()
    if (k.charge && !(await w.debit(chatId, k.charge))) { await go('bse-test'); return send(chatId, say('wallet_low', k.charge), kb([[L.cont], [L.back]])) }
    const r = await B.testSend(cid, info.bseCampaign, message, { charge: k.charge }); await go('bse-test')
    if (r.error) { if (k.charge) await w.credit(chatId, k.charge); return send(chatId, `⚠️ ${errText(lang, r)}`, testKb()) }
    if (r.free) return send(chatId, say('test_ok_free', c.testsPerDay), kb([[L.cont], [L.test], [L.back]]))
    return send(chatId, say('test_ok', r.left, k.charge), kb([...(r.left ? [[L.test]] : []), [L.cont], [L.back]]))
  }
  // Step 4 — one screen: send now (this hour, full price) or schedule (24 h+ ahead → cheaper), with the paid-replies toggle.
  // Only campaigns that pay the reply fee get replies forwarded; otherwise replies stay with the platform (STOP/HELP always honoured).
  async function askWhen() {
    const w = await B.whenOptions(cid, info.bseCampaign); if (w.error) return send(chatId, `⚠️ ${errText(lang, w)}`)
    const c = await B.cfg(); await go('bse-when')
    const hh = (h) => `${String(h).padStart(2, '0')}:00`, rows = [...(w.now ? [[L.now]] : w.later ? [[`${L.later} ${hh(w.later.hour)}`]] : []), [L.sched], [w.replyFee ? L.replies_off : L.replies_add(c.replyFee)], [L.back]]
    return send(chatId, say('when_q', { parts: w.parts, replyFee: w.replyFee, fee: c.replyFee, nowPrice: w.now?.price, later: w.later ? hh(w.later.hour) : null, laterPrice: w.later?.price, quiet: w.quiet, lines: w.lines, pct: w.schedule.pct, schedPrice: w.schedule.price, list: w.schedule.list, minHours: w.schedule.minHours }), kb(rows))
  }
  async function showBooking(b) {
    await put('bseBookingId', b._id); await go('bse-pay')
    const bal = await walletOps(T.db).balance(chatId).catch(() => null), c = await B.cfg()
    return send(chatId, say('booking', { code: b._id.slice(-6), parts: b.volume, date: b.date, hour: String(b.hour).padStart(2, '0'), end: b.estimatedCompletion.toISOString().slice(11, 16), price: b.price, unit: b.unitPrice, wallet: bal != null ? bal.toFixed(2) : null, hold: c.holdMinutes }) + (b.replyFee ? `\n${say('replies_line', b.replyFee)}` : '') + (b.discountPct ? `\n${say('disc_line', b.discountPct, b.listPrice)}` : b.mode === 'now' ? `\n${say('now_line')}` : ''), kb([[L.wallet], [L.other], [L.back]]))
  }
  if (action === 'bse-when') {
    const fee = (await B.cfg()).replyFee
    if (message === L.replies_add(fee) || message === L.replies_off) { await B.setReplies(cid, info.bseCampaign, message !== L.replies_off); return askWhen() }
    const laterH = message.startsWith(L.later) ? parseInt(message.slice(L.later.length).trim(), 10) : NaN
    if (message === L.now || laterH >= 0) {
      const r = await B.createBooking(cid, { campaignId: info.bseCampaign, ...(message === L.now ? { now: true } : { date: new Date().toISOString().slice(0, 10), hour: laterH }) })
      if (r.error === 'err_slot' || r.error === 'err_no_lines') { await send(chatId, `⚠️ ${say('now_gone')}`); return askWhen() }
      if (r.error) return send(chatId, `⚠️ ${errText(lang, r)}`)
      return showBooking(r.booking)
    }
    if (message === L.sched) { await go('bse-day'); return send(chatId, say('day_q'), kb([...days().map(d => [d]), [L.back]])) }
    return send(chatId, say('pick_option'))
  }
  if (action === 'bse-day') {
    const ahead = /^\d{4}-\d{2}-\d{2}$/.test(message) ? Math.round((Date.parse(`${message}T00:00:00Z`) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000) : -1
    if (!(ahead >= 0 && ahead <= 14)) return send(chatId, say('pick_option'))
    const { slots, capacity, dayFree } = await B.availability(message), cp = await B.db().collection('bsCampaigns').findOne({ _id: info.bseCampaign }), c = await B.cfg()
    if (!capacity) return send(chatId, `⚠️ ${say('err_no_lines')}`)
    const open = slots.filter(s => s.free > 0)
    if (!open.length || dayFree < cp.parts) { const n = await B.nextFreeDay(cp.parts, message); return send(chatId, `${say('no_cap_day')}${n ? `\n${say('next_free', n.date)}` : ''}`, kb([...(n ? [[n.date]] : []), ...days().map(d => [d]), [L.back]])) }
    await put('bseDay', message); await go('bse-hour')
    return send(chatId, say('hour_q', message, cp.parts, c.quietStart, c.quietEnd), kb([...open.map(s => [`${String(s.hour).padStart(2, '0')}:00 · ${s.free} ${say('free')}`]), [L.back]]))
  }
  if (action === 'bse-hour') {
    const h = parseInt(String(message), 10); if (!(h >= 0 && h < 24)) return send(chatId, say('pick_option'))
    const r = await B.createBooking(cid, { date: info.bseDay, hour: h, campaignId: info.bseCampaign })
    if (r.error === 'err_slot') { const cp = await B.db().collection('bsCampaigns').findOne({ _id: info.bseCampaign }), n = await B.nextFreeDay(cp?.parts || 500, info.bseDay); await go('bse-day'); return send(chatId, `⚠️ ${errText(lang, r)}${n ? `\n${say('next_free', n.date)}` : ''}`, kb([...(n ? [[n.date]] : []), ...days().map(d => [d]), [L.back]])) }
    if (r.error) return send(chatId, `⚠️ ${errText(lang, r)}`)
    return showBooking(r.booking)
  }
  if (action === 'bse-pay') {
    const b = await B.db().collection('bsBookings').findOne({ _id: info.bseBookingId, cid }); if (!b) return send(chatId, say('err_not_found'), HK)
    if (message === L.wallet) {
      const w = walletOps(T.db)
      if (!(await w.debit(chatId, b.price))) return send(chatId, say('wallet_low', b.price))
      const r = await B.confirmBooking(b._id, { method: 'wallet', amount: b.price })
      if (r.error) { await w.credit(chatId, b.price); return send(chatId, `⚠️ ${errText(lang, r)} ${say('not_charged')}`, HK) }
      await go('bse-home'); return true
    }
    if (message === L.other) { await put('dpProductKey', PRODUCT_KEY); await put('dpProductName', `eSIM BulkSMS ${b.volume} SMS`); await put('dpPrice', b.price); await go('none'); await goto['digital-product-pay'](); return true }
    return false
  }
  if (action === 'bse-one-to') { if (!/^\+?1?\d{10}$/.test(String(message).replace(/[\s()-]/g, ''))) return send(chatId, say('err_number')); await put('bseTo', message); await go('bse-one-text'); return send(chatId, say('one_text_q'), kb([[L.back]])) }
  if (action === 'bse-one-text' || action === 'bse-reply') {
    const r = await B.sendOne(cid, info.bseTo, message, action === 'bse-reply' ? info.bseSession : null)
    if (r.error) return send(chatId, `⚠️ ${errText(lang, r)}`)
    if (action === 'bse-one-text') await go('bse-home')
    return send(chatId, say('queued', r.segments, action === 'bse-reply'), action === 'bse-reply' ? kb([[L.back]]) : HK)
  }
  if (action === 'bse-conv') {
    const to = String(message).replace(/^💬\s*/, ''), s = await B.db().collection('bsSessions').findOne({ cid, to })
    if (!s) return send(chatId, say('pick_option'))
    const ms = await B.db().collection('bsMessages').find({ cid, $or: [{ to }, { from: to }] }).sort({ createdAt: -1 }).limit(10).toArray()
    await put('bseTo', to); await put('bseSession', s._id); await go('bse-reply')
    return send(chatId, `💬 <b>${to}</b>\n${ms.reverse().map(m => `${m.direction === 'in' ? '⬅️' : '➡️'} ${esc(m.body).slice(0, 300)}${m.direction === 'out' ? ` <i>(${say(`st_${m.status}`)})</i>` : ''}`).join('\n')}\n\n${say('reply_q')}`, kb([[L.back]]))
  }
  return false
}

// Crypto / bank checkout finished: money is in hand for this booking.
async function paid(chatId, info, amount, method) {
  const r = await B.confirmBooking(info?.bseBookingId, { method, amount }), lang = info?.userLanguage || 'en'
  if (r.error) { await walletOps(T.db).credit(chatId, Number(amount)); return { ok: false, text: `⚠️ ${errText(lang, r)} ${t(lang, 'to_wallet', amount)}` } }
  return { ok: true, text: t(lang, 'paid_ok') }
}

// Wallet chosen on the shared checkout screen.
async function paidFromWallet(chatId, info, price) {
  const w = walletOps(T.db), lang = info?.userLanguage || 'en'
  if (!(await w.debit(chatId, price))) return { ok: false, text: t(lang, 'wallet_low', price) }
  const r = await B.confirmBooking(info?.bseBookingId, { method: 'wallet', amount: price })
  if (r.error) { await w.credit(chatId, price); return { ok: false, text: `⚠️ ${errText(lang, r)} ${t(lang, 'not_charged')}` } }
  return { ok: true, text: t(lang, 'paid_ok') }
}

// Admin commands (bot admins only): /bulk, /bulkpause, /bulkresume, /bulkset key value, /bulkprovision, /bulktest, /bulkreplace ESIM-0001 reason,
// /bulklimit brand:chatId 3000, /bulksuspend brand:chatId, /bulkrestore brand:chatId, /bulkbookings, /bulkcancel bookingCode, /bulkwebhook, /bulkaccounts, /bulkreport, /bulklines, /bulkplan
async function admin(chatId, message, say) {
  const [cmd, a1, ...rest] = String(message).trim().split(/\s+/), by = `admin:${chatId}`, ok = (r) => say(r?.error ? `⚠️ ${r.args ? t('en', r.error, ...r.args) : r.error}` : `✅ Done${r?.esimId || r?.newEsimId ? ` (${r.esimId || r.newEsimId})` : ''}`)
  switch (cmd) {
    case '/bulk': {
      const o = await B.overview(), e = o.esims, f = o.forecast, c = o.config, cp = o.capacity
      const credit = o.credit == null ? '?' : `$${o.credit}${f ? ` · promised $${f.committed} · free $${f.available}${f.runway != null ? ` · ~${f.runway} days left` : ''}` : ''}`
      return say(`🛰 <b>eSIM BulkSMS</b>\n${o.paused.length ? `⏸ PAUSED: ${o.paused.join(', ')}` : '▶️ Sending'}\nSpenza credit: ${credit}\nAccounts: ${o.accounts.map(a => `#${a.n} ${a.lines}/${a.maxLines} lines · ${a.perMin}/min · $${a.credit ?? '?'}${a.low ? ' ⛔ low' : ''}`).join(' | ')}\neSIMs: ${e.total} total · ${e.active} usable · ${e.testing} testing · ${e.pending} pending · ${e.suspended} suspended · ${e.expired} expired · ${e.failed} failed · ${e.replaced} replaced\nCapacity: ${cp.perHour} SMS/hour · ${cp.perDay} SMS today · ${cp.tomorrow} tomorrow (${cp.lines} line(s), ${c.esimDailyLimit}/line/day${c.warmupDays ? ` after a ${c.warmupDays}-day warm-up` : ', no warm-up'}; line ceiling ${o.capacity.maxLines})${cp.unmet ? `\nRefused for capacity in the last 24 h: ${cp.unmet} SMS` : ''}\nAuto-buy: ${c.autoProvision && !c.manualApproval ? `ON (ceiling ${o.capacity.maxLines} lines${c.maxEsims ? '' : ' from the Spenza rate'}, budget: ${c.provisionBudget ? `$${c.provisionBudget}/month` : 'Spenza credit forecast'})` : 'OFF — /bulkset autoProvision true + /bulkset manualApproval false'} · auto-replace: ${c.autoReplace ? 'ON' : 'OFF'}\nToday: ${Object.entries(o.today).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nothing yet'}\n\n${e.list.map(x => `${x._id}${x.role === 'monitor' ? ' 🩺' : x.role === 'tester' ? ' 🧪' : ''} ${x.msisdn || '—'} ${x.status}/${x.health} score ${x.healthScore} · today ${x.today}/${x.cap} · ${x.stats?.sent || 0} sent${x.verify && x.status === 'testing' ? ' · delivery test' : ''}${x.expirationDate ? ` · plan to ${new Date(x.expirationDate).toISOString().slice(0, 10)}` : ''}`).join('\n') || 'No eSIMs yet — /bulkprovision'}`)
    }
    case '/bulkpause': await B.pause('admin', rest.join(' ') || a1 || 'manual'); return say('⏸ Paused.')
    case '/bulkresume': await B.resume('admin'); await B.creditWatch(); return say(`▶️ ${(await B.state()).reasons?.length ? `Still paused: ${(await B.state()).reasons.join(', ')}` : 'Sending.'}`)
    case '/bulkset': return a1 ? ok(await B.setConfig({ [a1]: rest[0] }, by)) : say(`Settings:\n${Object.entries(await B.cfg()).filter(([k]) => k !== 'accounts').map(([k, v]) => `${k} = ${v}`).join('\n')}`)
    case '/bulkprovision': return ok(await B.provisionOne('admin', by))
    case '/bulktest': await B.healthCheck(); return say('🩺 Health check done. /bulk to see results.')
    case '/bulkreplace': { const r = await B.replaceEsim(a1, rest.join(' ') || 'admin', by); return r.error || r.ok ? ok(r) : say(r.bought ? `⚠️ Spenza could not replace the number — new line ${r.bought} ordered instead.` : `❌ Spenza could not replace the number and ordering a new line failed: ${r.buyError}`) }
    case '/bulklimit': return ok(await B.setCustomer(a1, { dailyLimit: rest[0] }, by))
    case '/bulksuspend': return ok(await B.setCustomer(a1, { status: 'suspended' }, by))
    case '/bulkrestore': return ok(await B.setCustomer(a1, { status: 'active' }, by))
    case '/bulkbookings': { const bs = await B.db().collection('bsBookings').find({}).sort({ createdAt: -1 }).limit(15).toArray(); return say(bs.map(b => `${b._id.slice(-6)} ${b.cid} ${b.date} ${b.hour}:00 ${b.volume} SMS $${b.price} ${b.status}`).join('\n') || 'No bookings.') }
    case '/bulkcancel': { const b = await B.db().collection('bsBookings').findOne({ _id: new RegExp(`${String(a1 || '').replace(/\W/g, '')}$`) }); return ok(b ? await B.cancelBooking(b._id, { by: 'admin' }) : { error: 'Booking not found.' }) }
    case '/bulkwebhook': { const r = await B.registerWebhook(process.env.SELF_URL); return say(`Webhook → ${r.url} for ${r.accounts.length} account(s)${r.simulated ? ' (simulated)' : ''}`) }
    case '/bulkaccounts': { const o = await B.overview(), n = o.accounts.length; return say(`🔑 <b>Spenza accounts</b> (${n})\n${o.accounts.map(a => `#${a.n} · ${a.lines} of ${a.maxLines} lines · ${a.perMin} SMS/min · ceiling ${a.ceiling} SMS/day · credit $${a.credit ?? '?'}${a.available != null ? ` (free $${a.available})` : ''}${a.low ? ' · ⛔ LOW — lines sit out' : ''}`).join('\n')}\nPool ceiling: ${o.capacity.maxLines} lines · ${o.capacity.perDay} SMS today.\n${n < 9 ? `To add account #${n + 1}: set SPENZA_BULK_API_KEY_${n + 1} + SPENZA_BULK_API_SECRET_${n + 1} (and SPENZA_BULK_IMEI_${n + 1} if its handset differs) and redeploy — the engine connects it on start.` : 'Maximum accounts reached.'}`) }
    case '/bulkplan': { const p = await B.plan(await B.cfg()); return say(`📐 <b>Capacity plan</b> · ${p.lines} line(s), ceiling ${p.maxLines} · busiest day in the window: ${p.peak} SMS\nday · booked → target · have · ceiling · lines to buy\n${p.rows.map(r => `${r.date} · ${r.booked} → ${r.target} · ${r.have} · ${r.ceiling} · ${r.short ? `+${r.short}` : 'ok'}`).join('\n')}\nTarget = booked + room for one more full booking, never below the busiest recent day; capped by the Spenza rate × open hours.`) }
    case '/bulklines': { const L = await B.lineHistory(14); return say(L.length ? `📒 <b>Line history (14 days)</b> · n = new conversations · in = replies · ⛔ = STOPs\n${L.map(x => `\n<b>${x.id}</b> ${x.msisdn || '—'} · ${x.status}/${x.health} · age ${x.age}d · lifetime ${x.stats?.sent || 0} sent / ${x.stats?.failed || 0} failed${x.incidents.length ? `\n  ⚠️ ${x.incidents.map(i => `${i.type}${i.why ? ` (${i.why})` : ''} at age ${i.age ?? '?'}d`).join(', ')}` : ''}${x.days.map(d => `\n  ${d.day} age ${d.age}d: ${d.n} new · ${d.out} out · ${d.sent} sent · ${d.failed} failed · ${d.in} in · ⛔${d.stops}`).join('')}`).join('\n')}` : 'No lines yet.') }
    case '/bulkreport': { const rows = await B.db().collection('bsMessages').aggregate([{ $match: { direction: 'out', createdAt: { $gt: new Date(Date.now() - 7 * 86400000) } } }, { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, s: '$status' }, n: { $sum: 1 } } }, { $sort: { '_id.d': 1 } }]).toArray(); return say(`📊 Last 7 days\n${rows.map(r => `${r._id.d} ${r._id.s}: ${r.n}`).join('\n') || 'No traffic.'}`) }
    default: return false
  }
}

// Deliver this bot's notices (and refunds) from the shared queue, in each user's language.
function startNotices(bot, db) {
  const col = () => B.db().collection('bsNotify')
  setInterval(async () => {
    try {
      for (let i = 0; i < 20; i++) {
        const r = await col().findOneAndUpdate({ brand: brand(), sent: false }, { $set: { sent: true, sentAt: new Date() } }, { sort: { at: 1 } })
        const n = r?.value !== undefined ? r.value : r; if (!n) break
        if (n.type === 'refund' && n.amount) await walletOps(db).credit(n.chatId, Number(n.amount))
        const lang = (await db.collection('state').findOne({ _id: String(n.chatId) }, { projection: { userLanguage: 1 } }).catch(() => null))?.userLanguage || 'en'
        const text = n.key ? t(lang, n.key, ...(n.args || [])) : n.text
        await bot.sendMessage(n.chatId, text, { disable_web_page_preview: true, ...(n.type === 'inbound' ? { reply_markup: { inline_keyboard: [[{ text: t(lang, 'reply_btn'), callback_data: `bse-reply:${n.sessionId}` }]] } } : {}) }).catch(() => {})
      }
    } catch (_) { /* next round */ }
  }, 3000)
}
// Inline "Reply" under an incoming text → reply mode.
async function onCallback(q, { set, state, saveInfo, send, lang = 'en' }) {
  const sid = String(q.data || '').split(':')[1], chatId = q.message?.chat?.id
  const s = sid && await B.db().collection('bsSessions').findOne({ _id: sid, cid: B.cidOf(brand(), chatId) }); if (!s) return false
  await saveInfo('bseTo', s.to); await saveInfo('bseSession', s._id); await set(state, chatId, 'action', 'bse-reply')
  await send(chatId, t(lang, 'replying', s.to), kb([[btn(lang).back]])); return true
}
const homeBtn = (lang) => btn(lang || 'en').home

module.exports = { PRODUCT_KEY, BTN, homeBtn, handle, paid, paidFromWallet, admin, startNotices, onCallback, brand, init: (o) => { T = o; return B.init(o) } }
