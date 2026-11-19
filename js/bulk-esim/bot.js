'use strict'
// Telegram side of eSIM BulkSMS (USA/Canada): 4-step campaign wizard (numbers + free number check + consent → message, price type
// detected, optional rotation → optional test → when + replies → pay), one-off texts, conversations with reply, usage, bookings, progress, help. Every rule lives in core.js.
// Each bot delivers its own customers' notices (bsNotify) and wallet refunds. Texts: ./i18n.js (en, fr, zh, hi, fa).
const axios = require('axios')
const B = require('./core')
const { walletOps } = require('../cloudivr-web/wallet')
const { saveUpload } = require('./storage')
const { t, btn, allLabels, QN } = require('./i18n')

const PRODUCT_KEY = 'bulk-esim-sms'
const BTN = btn('en')
const kb = (rows) => ({ parse_mode: 'HTML', reply_markup: { keyboard: rows, resize_keyboard: true } })
const homeKb = (L, r = { one: true }) => kb([[L.newc], r.one && r.oneLeft !== 0 ? [L.one, L.convs] : [L.convs], [L.usage, L.bookings], [L.progress, L.help], [L.back]])
const brand = () => (process.env.CHAT_BOT_BRAND || 'Nomadly').replace(/[^A-Za-z0-9]/g, '')
// Nomadly's admin sends single texts free and without the 2-text or daily limit.
const unlimitedOne = (chatId) => brand() === 'Nomadly' && !!process.env.TELEGRAM_ADMIN_CHAT_ID && String(chatId) === String(process.env.TELEGRAM_ADMIN_CHAT_ID)
const oneLeftFor = async (chatId) => unlimitedOne(chatId) ? Infinity : B.oneLeft(B.cidOf(brand(), chatId))
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const per500 = (x) => Math.round(x * 500 * 100) / 100
const errText = (lang, r) => t(lang, r.error, ...(r.args || []))
const OLD_HOME = ['🛰 eSIM BulkSMS (USA/Canada)', '🛰 eSIM SMS en masse (USA/Canada)', '🛰 eSIM 群发短信（美国/加拿大）', '🛰 eSIM बल्क SMS (USA/कनाडा)', '🛰 پیامک انبوه eSIM (آمریکا/کانادا)'] // labels still on older keyboards
const isHome = (m) => m === '/esimsms' || allLabels('home').includes(m) || OLD_HOME.includes(m)
let T = null, BOT = null
const drafts = () => B.db().collection('bsDrafts')

async function homeArgs(cid) {
  const c = await B.cfg(), u = await B.usage(cid)
  return { min: c.minVolume, max: c.maxVolume, plain: per500(c.pricePlain), link: per500(c.priceLink), pct: c.scheduleDiscountPct, minHours: c.scheduleMinHours, fee: c.replyFee, perDay: c.testsPerDay, used: u.used, limit: u.limit, from: c.quietStart, to: c.quietEnd }
}
const home = async (send, chatId, lang) => { B.warmUp({ roles: 'tester' }).catch(() => {}); const r = { ...(await B.ready()), oneLeft: await oneLeftFor(chatId) }, win = await B.sendWindow(); return send(chatId, t(lang, 'home', await homeArgs(B.cidOf(brand(), chatId))) + (r.one ? '' : `\n\n${t(lang, 'off_one')}`) + (win.open ? '' : `\n\n${(QN[lang] || QN.en)(win)}`), homeKb(btn(lang), r)) }
const valRate = () => B.VAL_RATE()
const days = () => Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400000).toISOString().slice(0, 10))

// Returns true when the message was handled here (anything but an explicit false).
const handle = async (ctx) => (await flow(ctx)) !== false
async function flow({ chatId, msg, message, info, set, state, send, saveInfo, goto, bot }) {
  const action = info?.action || '', lang = info?.userLanguage || 'en', L = btn(lang), say = (k, ...a) => t(lang, k, ...a)
  const cid = B.cidOf(brand(), chatId), go = (a) => set(state, chatId, 'action', a), put = (k, v) => saveInfo(k, v)
  // /start always leaves BulkSMS for the main menu, whatever step the user is on.
  if (/^\/start\b/.test(String(message || '')) && action.startsWith('bse-')) { await go('none'); if (info) info.action = 'none'; return false }
  if (isHome(message) && !B.configured()) { await send(chatId, say('soon')); return true }
  if (isHome(message)) {
    const from = msg?.from || {}
    await B.customer(brand(), chatId, { username: from.username, firstName: from.first_name, lastName: from.last_name }); await go('bse-home')
    if (!info?.bseIntroAt) await put('bseIntroAt', new Date().toISOString()) // the start screen now carries the intro
    await home(send, chatId, lang); return true
  }
  if (info?.bseReviewPrompt && msg?.reply_to_message?.message_id === info.bseReviewPrompt && message && !String(message).startsWith('/')) {
    const r = await B.reviewAnswer(info.bseReviewId, cid, 'comment', message); await put('bseReviewPrompt', null)
    if (r) await rvAlert(`💬 <b>${r.kind === 'campaign' ? 'Campaign' : 'Single-text'} review comment</b> (${ARR[r.arrived] || '—'}${r.stars ? ` · ${r.stars}/5` : ''})\n${rvLine(r)}\n“${esc(String(message).slice(0, 500))}”`)
    await send(chatId, say('rv_comment_ok')); return true
  }
  if (unlimitedOne(chatId) && allLabels('one').includes(message) && !action.startsWith('bse-')) {
    if (!B.configured()) { await send(chatId, say('soon')); return true }
    await B.customer(brand(), chatId, { username: msg?.from?.username, firstName: msg?.from?.first_name, lastName: msg?.from?.last_name }); if (!(await B.ready()).one) return send(chatId, say('off_one'))
    await go('bse-one-to'); return send(chatId, say('one_to_q'), kb([[L.back]]))
  }
  // Hand-off buttons work from any screen while the offered list is waiting.
  const hoLabel = ['ho_now', 'ho_later', 'ho_file'].some(k => allLabels(k).includes(message))
  if (hoLabel && action !== 'bse-handoff' && await B.db().collection('bsHandoff').findOne({ _id: cid }, { projection: { _id: 1 } })) { await go('bse-handoff'); return flow({ chatId, msg, message, info: { ...info, action: 'bse-handoff' }, set, state, send, saveInfo, goto, bot }) }
  if (!action.startsWith('bse-')) return false
  const RD = { ...(await B.ready()), oneLeft: await oneLeftFor(chatId) }, HK = homeKb(L, RD)
  const askContacts = async (pre = '') => { const c = await B.cfg(), lists = (await B.savedLists(cid)).length; return send(chatId, `${pre}${say('contacts_q', { min: c.minVolume, max: c.maxVolume })}\n\n${say('val_tip', { sms: c.pricePlain.toFixed(2), val: valRate().toFixed(3) })}`, kb([...(lists ? [[L.lists]] : []), [L.validate_first], [L.back]])) }
  // Validated numbers (hand-off or a saved list) → Step 1 done, straight to the consent screen.
  const useList = async (numbers, pref = 'now') => {
    const c = await B.cfg(), r = await B.parseContacts(cid, numbers.join('\n')), list = r.contacts.slice(0, c.maxVolume), min = c.validatedMinVolume ?? 100
    if (list.length < min) { await go('bse-home'); return send(chatId, say('ho_few', min, list.length), HK) }
    await send(chatId, say('checking', list.length))
    const k = await B.checkNumbers(cid, list)
    if (!k.sendable) { await go('bse-home'); return send(chatId, `⚠️ ${say('err_no_mobile')}`, HK) }
    await drafts().updateOne({ _id: cid }, { $set: { contacts: list, skip: k.skip, file: null, validated: true, validate: false, at: new Date() } }, { upsert: true })
    await put('bseWhenPref', pref); await put('bseValFirst', null); await go('bse-consent')
    return send(chatId, `${say('ho_validated')}\n${say('list_ok', { n: list.length, max: c.maxVolume, dropped: r.contacts.length - list.length, send: k.sendable, skipped: k.skip.length, counts: k.counts, invalid: r.invalid, duplicates: r.duplicates, optedOut: r.optedOut })}`, kb([[L.agree], [L.back]]))
  }
  const markValidate = async (n) => { await drafts().updateOne({ _id: cid }, { $set: { validate: true } }); const c = await B.cfg(); return send(chatId, say('val_marked', { n, fee: (Math.round(n * valRate() * 100) / 100).toFixed(2) }), kb([[L.agree], [L.back]])) }
  // Hands the list to the paid validator; when it's done the customer lands back here with the valid numbers (offerSend).
  if (message === L.back || /^(↩️ |🔙 |⬅️ )?(Back|Retour|返回|वापस|بازگشت)$/.test(String(message || '').trim())) { if (action === 'bse-home') { await go('none'); return goto.submenu7 ? (await goto.submenu7(), true) : false } await go('bse-home'); await home(send, chatId, lang); return true }
  if (action === 'bse-home') {
    if (message === L.newc) { await go('bse-contacts'); return askContacts() }
    if (message === L.one) { if (!RD.one) return send(chatId, say('off_one'), HK); if (!RD.oneLeft) return send(chatId, `⚠️ ${say('err_one_used', (await B.cfg()).freeOneSends ?? 2)}`, HK); await go('bse-one-to'); return send(chatId, say('one_to_q'), kb([[L.back]])) }
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
  if (action === 'bse-lists') {
    const ls = (await B.savedLists(cid)).filter(x => (info.bseListIds || []).includes(x._id))
    const pick = ls.find(x => say('list_label', { n: x.n, date: x.at.toISOString().slice(0, 10) }) === message)
    if (!pick) return send(chatId, say('pick_option'))
    return useList(pick.numbers)
  }
  // After validating or buying leads: the list goes straight into a campaign (Step 1 done, validated).
  if (action === 'bse-handoff') {
    if (message === L.ho_file) { await go('none'); await send(chatId, say('ho_file_ok')); if (goto.displayMainMenuButtons) await goto.displayMainMenuButtons(); return true }
    if (message !== L.ho_now && message !== L.ho_later) { await go('none'); if (info) info.action = 'none'; return false }
    const h = await B.db().collection('bsHandoff').findOne({ _id: cid })
    if (!h?.numbers?.length) { await go('bse-home'); await send(chatId, say('ho_gone')); return home(send, chatId, lang) }
    await B.customer(brand(), chatId, { username: msg?.from?.username, firstName: msg?.from?.first_name, lastName: msg?.from?.last_name })
    await B.db().collection('bsHandoff').deleteOne({ _id: cid })
    return useList(h.numbers, message === L.ho_later ? 'later' : 'now')
  }
  if (action === 'bse-cancel') { const b = await B.db().collection('bsBookings').findOne({ cid, _id: new RegExp(`${String(message).trim().replace(/\W/g, '')}$`) }); const r = b ? await B.cancelBooking(b._id, { cid }) : { error: 'err_not_found' }; await go('bse-home'); return send(chatId, r.error ? `⚠️ ${errText(lang, r)}` : say('cancelled', r.refunded), HK) }
  const testKb = (barred) => kb([...(RD.test && !barred ? [[L.test], [L.test_skip]] : [[L.cont]]), [L.back]])
  const arrivedKb = () => kb([[L.arrived_yes], [L.arrived_spam], [L.arrived_no], [L.back]])
  const askTestTo = async (free) => { await go('bse-test-to'); return send(chatId, say('test_to_q', free), kb([...(info.bseTestTo ? [[info.bseTestTo]] : []), [L.test_skip], [L.back]])) }
  const unitOf = (c, links) => (links ? c.priceLink : c.pricePlain)
  const contentAsk = async (key = 'content_q') => { const c = await B.cfg(), optOut = info.bseOptOut !== false; return send(chatId, say(key, { max: optOut ? 160 - B.OPT.length : 160, optOut, plain: per500(c.pricePlain), link: per500(c.priceLink) }), kb([[optOut ? L.optout_no : L.optout_yes], [L.back]])) }
  // Step 1 — numbers: parsed, capped at maxVolume, checked (Telnyx carrier lookup, free); every kept number is billed, only mobiles are texted.
  if (action === 'bse-contacts') {
    if (message === L.validate_first) { await put('bseValFirst', true); return send(chatId, say('val_upload'), kb([[L.back]])) }
    if (message === L.lists) {
      const ls = await B.savedLists(cid); if (!ls.length) return askContacts()
      await put('bseListIds', ls.map(x => x._id)); await go('bse-lists')
      return send(chatId, say('lists_q'), kb([...ls.map(x => [say('list_label', { n: x.n, date: x.at.toISOString().slice(0, 10) })]), [L.back]]))
    }
    let raw = message, fileName = null
    if (msg?.document) {
      const name = msg.document.file_name || ''
      if (!/\.(txt|csv)$/i.test(name) || (msg.document.file_size || 0) > 2e6) return send(chatId, say('file_bad'))
      try { const link = await bot.getFileLink(msg.document.file_id); raw = String((await axios.get(link, { timeout: 20000, responseType: 'text', maxContentLength: 2e6 })).data) } catch (_) { return send(chatId, say('file_bad')) }
      fileName = name
    }
    let plusOne = false
    if ((message === L.plus1_add || message === L.plus1_skip) && info.bseRaw) { plusOne = message === L.plus1_add; raw = info.bseRaw.raw; fileName = info.bseRaw.fileName || null }
    else if (!msg?.document && !String(raw || '').trim()) return send(chatId, say('pick_option'))
    const r = await B.parseContacts(cid, raw, { plusOne }), c = await B.cfg()
    if (r.noCode && !plusOne && message !== L.plus1_skip) { // no country code → ask before adding +1 (never silently)
      await put('bseRaw', { raw, fileName })
      return send(chatId, say('plus1_q', r.noCode, r.contacts.length), kb([[L.plus1_add], ...(r.contacts.length ? [[L.plus1_skip]] : []), [L.back]]))
    }
    if (info.bseRaw) await put('bseRaw', null)
    const ccNote = r.fixed ? `\n\n${say('plus1_fixed', r.fixed)}` : r.noCode ? `\n\n${say('nocode', r.noCode)}` : ''
    if (r.contacts.length < c.minVolume) return send(chatId, say('contacts_few', { ...r, n: r.contacts.length, parts: r.contacts.length }, c.minVolume) + ccNote, { parse_mode: 'HTML' })
    const list = r.contacts.slice(0, c.maxVolume)
    await send(chatId, say('checking', list.length))
    const k = await B.checkNumbers(cid, list)
    if (!k.sendable) return send(chatId, `⚠️ ${say('err_no_mobile')}`)
    await drafts().updateOne({ _id: cid }, { $set: { contacts: list, skip: k.skip, file: fileName ? { name: fileName, raw } : null, validated: false, validate: false, at: new Date() } }, { upsert: true })
    await go('bse-consent')
    // Skipped numbers are still billed → show what validating first would save.
    const waste = Math.round(k.skip.length * c.pricePlain * 100) / 100, valCost = Math.round(list.length * valRate() * 100) / 100
    const save = k.skip.length ? `\n\n${say('val_save', { skipped: k.skip.length, waste, cost: valCost })}` : ''
    const okText = say('list_ok', { n: list.length, max: c.maxVolume, dropped: r.contacts.length - list.length, send: k.sendable, skipped: k.skip.length, counts: k.counts, invalid: r.invalid, duplicates: r.duplicates, optedOut: r.optedOut }) + ccNote
    if (info.bseValFirst) { await put('bseValFirst', null); await send(chatId, okText); return markValidate(list.length) }
    return send(chatId, okText + save, kb([[L.agree], [L.validate_these], [L.back]]))
  }
  if (action === 'bse-consent') {
    if (message === L.validate_these) { const d = await drafts().findOne({ _id: cid }); if (d?.contacts?.length && !d.validated) return markValidate(d.contacts.length) }
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
    const cr = await B.createCampaign(cid, { name: content[0].slice(0, 40), content, contacts: d.contacts || [], skip: d.skip || [], validated: !!d.validated, validate: !!d.validate, linksUnchecked: !!info.bseLinksUnchecked, optOut: info.bseOptOut !== false, consent: true, uploadId: upload?._id })
    if (cr.error) { await go('bse-contacts'); return askContacts(`⚠️ ${errText(lang, cr)}\n\n`) }
    const cp = cr.campaign, c = await B.cfg(), unit = unitOf(c, cp.withLinks)
    await put('bseCampaign', cp._id); await drafts().deleteOne({ _id: cid }); await go('bse-test')
    const o = await B.testOffer(cid)
    return send(chatId, say('ready', { n: cp.volume, v: cp.content.length, price: Math.round(cp.parts * unit * 100) / 100, unit, tests: c.testSends, free: o.free, open: o.open, barred: o.barred, perDay: c.testsPerDay }) + (RD.test ? '' : `\n\n${say('off_test')}`), testKb(o.barred))
  }
  // Tests go to any USA/Canada number. Never paid for a campaign → one free test, no wallet needed. Otherwise the wallet must cover
  // the campaign (so tests mean "about to buy"), each test is charged at the unit price (refunded when the campaign is paid), quota applies.
  const price = async (cp) => { const c = await B.cfg(); return Math.round((cp.parts * unitOf(c, cp.withLinks) + (cp.replies ? c.replyFee : 0)) * 100) / 100 }
  if (action === 'bse-test') {
    if (message === L.test) {
      if (!RD.test && !info.bseAltFrom) return send(chatId, say('off_test'), testKb())
      const o = await B.testOffer(cid), c = await B.cfg()
      if (o.barred) return send(chatId, `⚠️ ${say('err_test_guard')}`, kb([[L.cont], [L.back]]))
      if (!o.free) {
        const cp = await B.db().collection('bsCampaigns').findOne({ _id: info.bseCampaign, cid }), need = cp ? await price(cp) : 0, bal = await walletOps(T.db).balance(chatId).catch(() => 0)
        if (bal < need) return send(chatId, say('test_locked', need, Number(bal).toFixed(2), { firstTime: o.firstTime, perDay: c.testsPerDay }), kb([[L.cont], [L.back]]))
      }
      return askTestTo(o.free)
    }
    if (message === L.cont || message === L.test_skip) return askWhen()
    return false
  }
  if (action === 'bse-test-to') {
    if (message === L.cont || message === L.test_skip || message === L.send_anyway) return askWhen()
    const k = await B.testCheck(cid, info.bseCampaign, message, { altFrom: info.bseAltFrom || null }); if (k.error) return send(chatId, `⚠️ ${errText(lang, k)}`, kb([[L.cont], [L.back]]))
    const w = walletOps(T.db)
    if (k.charge && !(await w.debit(chatId, k.charge))) {
      await go('bse-test')
      // One tap to the crypto top-up (the test screen's buttons stay); the test can be sent again right after.
      if (!bot) return send(chatId, say('wallet_low', k.charge), kb([[L.cont], [L.back]]))
      return bot.sendMessage(chatId, say('wallet_low', k.charge), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: say('topup_btn'), callback_data: 'wallet_topup_quick' }]] } }).catch(() => {})
    }
    const r = await B.testSend(cid, info.bseCampaign, message, { charge: k.charge, altFrom: info.bseAltFrom || null }); await go('bse-test'); if (info.bseAltFrom) await put('bseAltFrom', null)
    if (r.error) { if (k.charge) await w.credit(chatId, k.charge); return send(chatId, `⚠️ ${errText(lang, r)}`, testKb(r.error === 'err_test_guard')) }
    await put('bseTestMsg', r.messageId); await put('bseTestTo', k.to); await go('bse-test-check')
    return send(chatId, say('test_sent_q', k.to), arrivedKb())
  }
  // Guided: "Did it arrive?" → yes: choose when · no: tips, change the text, test again or continue anyway.
  if (action === 'bse-test-check') {
    if (message === L.arrived_spam) {
      const f = await B.testFeedback(cid, info.bseTestMsg, 'spam'); await put('bseAltFrom', f.esimId || null)
      await send(chatId, say('tips_checking'))
      const tp = await B.aiTips(cid, info.bseCampaign); await put('bseRewrite', tp.rewrite || null)
      const words = (tp.risky || []).map(x => `• <b>${esc(x.word)}</b> — ${esc(x.why)}`).join('\n')
      return send(chatId, `${say('test_spam')}${words ? `\n\n⚠️ <b>${say('spam_words')}</b>\n${words}` : ''}${tp.rewrite ? `\n\n✨ <b>${say('spam_safer')}</b>\n<i>${esc(tp.rewrite)}</i>` : ''}`, kb([...(RD.test || f.esimId ? [[L.test_other_line]] : []), ...(tp.rewrite ? [[L.use_rewrite]] : []), [L.edit], [L.send_anyway], [L.back]]))
    }
    if (message === L.test_other_line) { if (await B.testBarred(cid)) return send(chatId, `⚠️ ${say('err_test_guard')}`, kb([[L.cont], [L.back]])); return askTestTo((await B.testOffer(cid)).free) }
    if (message === L.arrived_yes || message === L.arrived_no) {
      const f = await B.testFeedback(cid, info.bseTestMsg, message === L.arrived_yes)
      if (f.wait) return send(chatId, say('test_wait'), arrivedKb())
      if (message === L.arrived_yes) { await send(chatId, say('test_yes')); return askWhen() }
      await send(chatId, say('tips_checking'))
      const tp = await B.aiTips(cid, info.bseCampaign); await put('bseRewrite', tp.rewrite || null)
      const words = (tp.risky || []).map(x => `• <b>${esc(x.word)}</b> — ${esc(x.why)}`).join('\n')
      return send(chatId, tp.error ? say('test_no') : say('tips', { words, rewrite: tp.rewrite ? esc(tp.rewrite) : null }), kb([...(tp.rewrite ? [[L.use_rewrite]] : []), [L.edit], ...(RD.test ? [[L.test_again]] : []), [L.send_anyway], [L.back]]))
    }
    if (message === L.test_again) { if (await B.testBarred(cid)) return send(chatId, `⚠️ ${say('err_test_guard')}`, kb([[L.cont], [L.back]])); return askTestTo((await B.testOffer(cid)).free) }
    if (message === L.edit || (message === L.use_rewrite && info.bseRewrite)) {
      const cp = await B.db().collection('bsCampaigns').findOne({ _id: info.bseCampaign, cid }); if (!cp) return send(chatId, say('err_not_found'), HK)
      await drafts().updateOne({ _id: cid }, { $set: { contacts: [...cp.contacts, ...(cp.skipped || [])], skip: cp.skipped || [], file: null, validated: !!cp.validated, at: new Date() } }, { upsert: true })
      await B.db().collection('bsCampaigns').deleteOne({ _id: cp._id, cid, status: 'draft' }) // a new campaign is made from the edited text
      if (message === L.use_rewrite) { info.bseContent = [info.bseRewrite]; await put('bseContent', info.bseContent); info.bseOptOut = cp.optOut !== false; await put('bseOptOut', info.bseOptOut); await put('bseRewrite', null); return finalize([]) }
      await go('bse-content'); return contentAsk()
    }
    if (message === L.send_anyway || message === L.cont) return askWhen()
    return send(chatId, say('pick_option'), arrivedKb())
  }
  // Step 4 — one screen: send now (this hour, full price) or schedule (24 h+ ahead → cheaper), with the paid-replies toggle.
  // Only campaigns that pay the reply fee get replies forwarded; otherwise replies stay with the platform (STOP/HELP always honoured).
  async function askWhen() {
    const w = await B.whenOptions(cid, info.bseCampaign); if (w.error) return send(chatId, `⚠️ ${errText(lang, w)}`)
    const c = await B.cfg(); await go('bse-when')
    const hh = (h) => `${String(h).padStart(2, '0')}:00`, first = [...(w.now ? [[L.now]] : w.later ? [[`${L.later} ${hh(w.later.hour)}`]] : [])], rows = [...(info.bseWhenPref === 'later' ? [[L.sched], ...first] : [...first, [L.sched]]), [w.replyFee ? L.replies_off : L.replies_add(c.replyFee)], [L.back]]
    return send(chatId, say('when_q', { parts: w.parts, replyFee: w.replyFee, fee: c.replyFee, nowPrice: w.now?.price, later: w.later ? hh(w.later.hour) : null, laterPrice: w.later?.price, quiet: w.quiet, win: w.window && !w.window.open ? w.window : null, lines: w.lines, pct: w.schedule.pct, schedPrice: w.schedule.price, list: w.schedule.list, minHours: w.schedule.minHours }) + (w.off ? `\n\n${say('off_now')}` : ''), kb(rows))
  }
  async function showBooking(b) {
    const c = await B.cfg()
    // Same one-screen checkout as every other product: wallet + crypto coins (+ bank) on one invoice.
    const summary = say('booking', { code: b._id.slice(-6), parts: b.volume, date: b.date, hour: String(b.hour).padStart(2, '0'), end: b.estimatedCompletion.toISOString().slice(11, 16), price: b.price, unit: b.unitPrice, wallet: null, hold: c.holdMinutes }) + (b.replyFee ? `\n${say('replies_line', b.replyFee)}` : '') + (b.valFee ? `\n${say('val_line', { n: Math.round(b.valFee / valRate()), fee: b.valFee.toFixed(2) })}` : '') + (b.discountPct ? `\n${say('disc_line', b.discountPct, b.listPrice)}` : b.mode === 'now' ? `\n${say('now_line')}` : '')
    await put('bseBookingId', b._id); await put('dpProductKey', PRODUCT_KEY); await put('dpProductName', `eSIM BulkSMS ${b.volume} SMS`); await put('dpPrice', b.price); await put('bseSummary', summary)
    await go('none'); await goto['digital-product-pay'](); return true
  }
  if (action === 'bse-when') {
    const fee = (await B.cfg()).replyFee
    if (message === L.replies_add(fee) || message === L.replies_off) { await B.setReplies(cid, info.bseCampaign, message !== L.replies_off); return askWhen() }
    const laterH = message.startsWith(L.later) ? parseInt(message.slice(L.later.length).trim(), 10) : NaN
    if (message === L.now || laterH >= 0) {
      const r = await B.createBooking(cid, { campaignId: info.bseCampaign, ...(message === L.now ? { now: true } : { date: new Date().toISOString().slice(0, 10), hour: laterH }) })
      if (r.error === 'off_now') return askWhen()
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
      // Short: the shared checkout uses the wallet first and takes only the rest in crypto, then confirms the booking itself.
      if (!(await w.debit(chatId, b.price))) return showBooking(b)
      const r = await confirmPaid(chatId, b._id, 'wallet', b.price, lang)
      if (r.error) { await w.credit(chatId, b.price); return send(chatId, `⚠️ ${errText(lang, r)} ${say('not_charged')}`, HK) }
      await go('bse-home'); if (r.validating) await send(chatId, say('val_running', Math.round(b.valFee / valRate())), HK); return true
    }
    if (message === L.other) { await put('dpProductKey', PRODUCT_KEY); await put('dpProductName', `eSIM BulkSMS ${b.volume} SMS`); await put('dpPrice', b.price); await go('none'); await goto['digital-product-pay'](); return true }
    return false
  }
  if (action === 'bse-one-to') { if (!/^(\+|00)?1\d{10}$/.test(String(message).replace(/[\s().-]/g, ''))) return send(chatId, say('err_number'), { parse_mode: 'HTML' }); if (!unlimitedOne(chatId) && await B.numberBusy(cid, B.normPhone(String(message).replace(/[\s().-]/g, '')) || message)) { await go('bse-home'); return send(chatId, `⚠️ ${say('err_number_busy', (await B.cfg()).sessionHours)}`, HK) } await put('bseTo', message); await go('bse-one-opt'); return send(chatId, say('one_opt_q'), kb([[L.one_opt_yes, L.one_opt_no], [L.back]])) }
  if (action === 'bse-one-opt') {
    if (message !== L.one_opt_yes && message !== L.one_opt_no) return send(chatId, say('pick_option'), kb([[L.one_opt_yes, L.one_opt_no], [L.back]]))
    const opt = message === L.one_opt_yes; await put('bseOneOpt', opt); await go('bse-one-text'); return send(chatId, say(opt ? 'one_text_q' : 'one_text_q_plain'), kb([[L.back]]))
  }
  if (action === 'bse-one-text' || action === 'bse-reply') {
    // After the free intro (any review, or 3 free texts used) single texts are paid: $1 each, wallet must hold at least $20.
    // Charged on a successful send, refunded if it fails.
    const bill = await B.singleTextMode(cid).catch(() => ({ paid: false }))
    const w = walletOps(T.db)
    const topupKb = { reply_markup: { inline_keyboard: [[{ text: say('topup_btn'), callback_data: 'wallet_topup_quick' }]] } }
    const r2 = (x) => Math.round(x * 100) / 100
    if (bill.paid) {
      const bal = await w.balance(chatId).catch(() => 0)
      if (bal >= bill.minBalance) bill.free = await B.winbackTake(cid).catch(() => null)
      if (bal < bill.minBalance || (!bill.free && !(await w.debit(chatId, bill.price)))) {
        if (action === 'bse-one-text') await go('bse-home')
        // The reply keyboard from the earlier screen stays on; this message carries the one-tap top-up.
        // Keep the text: it goes out by itself once the wallet is topped up (within 24 hours).
        await B.savePendingText(cid, { to: info.bseTo, message, session: action === 'bse-reply' ? info.bseSession || null : null, optOut: info.bseOneOpt !== false, lang }).catch(() => {})
        const low = `${say('one_min_balance', { min: bill.minBalance, bal: r2(bal) })}\n\n${say('one_pending_note')}`
        return bot ? bot.sendMessage(chatId, low, topupKb).catch(() => {}) : send(chatId, low, HK)
      }
    }
    const r = await B.sendOne(cid, info.bseTo, message, action === 'bse-reply' ? info.bseSession : null, { optOut: info.bseOneOpt !== false, unlimited: action === 'bse-one-text' && unlimitedOne(chatId) })
    if (bill.paid && r.error) await (bill.free ? B.winbackGive(cid) : w.credit(chatId, bill.price)).catch(() => {})
    if (['err_number_busy', 'err_one_used', 'err_one_slow', 'err_one_bulk', 'err_one_blocked', 'reply_route_changed', 'reply_campaign_only'].includes(r.error)) { await go('bse-home'); return send(chatId, `⚠️ ${errText(lang, r)}`, HK) }
    if (r.error) return send(chatId, `⚠️ ${errText(lang, r)}`)
    if (action === 'bse-one-text') await go('bse-home')
    // Paid sends get a receipt line; once the balance drops below the minimum, a one-tap top-up button follows.
    const left = bill.paid ? r2(await w.balance(chatId).catch(() => 0)) : null
    const receipt = bill.free ? `\n${say('wb_receipt', { left: bill.free.left, bal: left })}` : bill.paid ? `\n${say('one_receipt', { charged: bill.price, bal: left })}` : (r.left != null ? `\n${say('one_left', r.left)}` : '')
    await send(chatId, say('queued', r.segments, action === 'bse-reply') + receipt, action === 'bse-reply' ? kb([[L.back]]) : homeKb(L, { ...RD, oneLeft: bill.paid ? null : r.left }))
    if (bill.paid && left < bill.minBalance) await bot?.sendMessage(chatId, say('one_topup_q', { bal: left, min: bill.minBalance }), topupKb).catch(() => {})
    return
  }
  if (action === 'bse-conv') {
    const to = String(message).replace(/^💬\s*/, ''), s = await B.db().collection('bsSessions').findOne({ cid, to })
    if (!s) return send(chatId, say('pick_option'))
    const ms = await B.db().collection('bsMessages').find({ cid, $or: [{ to }, { from: to }] }).sort({ createdAt: -1 }).limit(10).toArray()
    const rr = await B.replyRoute(cid, s._id), live = !rr.error; if (live) { await put('bseTo', to); await put('bseSession', s._id); await go('bse-reply') }
    return send(chatId, `💬 <b>${to}</b>\n${ms.reverse().map(m => `${m.direction === 'in' ? '⬅️' : '➡️'} ${esc(m.body).slice(0, 300)}${m.direction === 'out' ? ` <i>(${say(`st_${m.status}`)})</i>` : ''}`).join('\n')}\n\n${say(live ? 'reply_q' : rr.error)}`, kb([[L.back]]))
  }
  return false
}

// Crypto / bank checkout finished: money is in hand for this booking.
// Payment in: bookings with validation run it first, then confirm with the re-priced amount (unused part → wallet).
async function confirmPaid(chatId, bid, method, amount, lang) {
  const db = B.db(), b = await db.collection('bsBookings').findOne({ _id: bid }), cp = b?.campaignId && await db.collection('bsCampaigns').findOne({ _id: b.campaignId })
  if (!b?.valFee || !cp?.validate || cp.validatedAt || !T?.validate) return B.confirmBooking(bid, { method, amount })
  if (!['pending', 'awaiting_payment'].includes(b.status) || b.paymentStatus === 'paid_validating') return B.confirmBooking(bid, { method, amount })
  await db.collection('bsBookings').updateOne({ _id: bid }, { $set: { paymentStatus: 'paid_validating', paidAmount: amount, paidMethod: method, holdUntil: new Date(Date.now() + 3 * 3600e3) } })
  runValidation(chatId, b, cp, method, amount, lang).catch(e => T.log?.(`[BulkESIM] validation for ${bid} failed: ${e.message}`))
  return { ok: true, validating: true, n: cp.contacts.length + (cp.skipped || []).length }
}
async function runValidation(chatId, b, cp, method, amount, lang) {
  const db = B.db(), w = walletOps(T.db), say = (k, ...a) => t(lang, k, ...a), tell = (x) => T.sendMessage?.(chatId, x, { parse_mode: 'HTML' }), fee = b.valFee
  const all = [...cp.contacts, ...(cp.skipped || [])]
  let valid = null
  try { const res = await T.validate(all.map(p => p.replace(/\D/g, '')), chatId); if (Array.isArray(res)) valid = res.map(x => String(Array.isArray(x) ? x[0] : x)).map(p => (p.startsWith('+') ? p : `+${p.replace(/\D/g, '')}`)) } catch (_) { valid = null }
  if (!valid) {
    // Validator down: text the full list, validation fee back to the wallet.
    await db.collection('bsCampaigns').updateOne({ _id: cp._id }, { $set: { validate: false } })
    await db.collection('bsBookings').updateOne({ _id: b._id }, { $set: { price: Math.round((b.price - fee) * 100) / 100, valFee: 0 } })
    await w.credit(chatId, fee); await tell(say('val_failed', fee))
    const r = await B.confirmBooking(b._id, { method, amount: Math.round((amount - fee) * 100) / 100 })
    if (r.error) { await w.credit(chatId, Math.round((amount - fee) * 100) / 100); await tell(`⚠️ ${errText(lang, r)} ${say('to_wallet', Math.round((amount - fee) * 100) / 100)}`) }
    return
  }
  const v = await B.applyValidation(b._id, valid, amount)
  if (v.error) {
    const refund = Math.round((amount - fee) * 100) / 100
    await B.cancelBooking(b._id, { by: 'system' }).catch(() => {}); await w.credit(chatId, refund)
    return tell(say('val_few_refund', { n: v.n, min: (await B.cfg()).validatedMinVolume ?? 100, refund }))
  }
  if (v.refund > 0) await w.credit(chatId, v.refund)
  const r = await B.confirmBooking(b._id, { method, amount: v.price })
  if (r.error) { await w.credit(chatId, v.price); return tell(`⚠️ ${errText(lang, r)} ${say('to_wallet', v.price)}`) }
  return tell(say('val_done', { n: v.n, removed: v.removed, refund: v.refund }))
}

async function paid(chatId, info, amount, method) {
  const lang = info?.userLanguage || 'en', r = await confirmPaid(chatId, info?.bseBookingId, method, Number(amount), lang)
  if (r.error) { await walletOps(T.db).credit(chatId, Number(amount)); return { ok: false, text: `⚠️ ${errText(lang, r)} ${t(lang, 'to_wallet', amount)}` } }
  return { ok: true, text: r.validating ? t(lang, 'val_running', r.n) : t(lang, 'paid_ok') }
}

// Wallet chosen on the shared checkout screen.
async function paidFromWallet(chatId, info, price) {
  const w = walletOps(T.db), lang = info?.userLanguage || 'en'
  if (!(await w.debit(chatId, price))) return { ok: false, text: t(lang, 'wallet_low', price) }
  const r = await confirmPaid(chatId, info?.bseBookingId, 'wallet', price, lang)
  if (r.error) { await w.credit(chatId, price); return { ok: false, text: `⚠️ ${errText(lang, r)} ${t(lang, 'not_charged')}` } }
  return { ok: true, text: r.validating ? t(lang, 'val_running', r.n) : t(lang, 'paid_ok') }
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
    case '/bulkguard': { if (a1) return ok(await B.oneGuardSet(a1, rest[0], by)); const g = await B.oneGuardList(); return say(g.length ? `🕵️ <b>Single-text guard</b>\n${g.map(x => `${x._id}${x.username ? ` @${x.username}` : ''} · ${x.oneGuard.trusted ? 'trusted' : x.oneGuard.blocked ? '⛔ blocked' : x.oneGuard.testOff && !x.oneGuard.strikes ? '🧪 tests removed' : x.oneGuard.level === 2 ? '🚧 refused for 24 h' : 'slowed'}${x.oneGuard.strikes ? ` · ${x.oneGuard.strikes} strike(s)` : ''}`).join('\n')}\n\n/bulkguard &lt;customer&gt; clear | trust` : 'Nobody flagged. Single texts are unlimited only when /bulkset freeOneSends 0.') }
    case '/bulkbackfill': {
      const nameOfCol = T?.db?.collection('nameOf')
      if (!nameOfCol) return say('⚠️ Main DB nameOf collection not available.')
      const r = await B.backfillIdentity(nameOfCol)
      return say(r.ok ? `✅ Backfill done: ${r.updated} updated, ${r.notFound} not found (${r.total} missing total).` : `⚠️ ${r.error}`)
    }
    case '/bulkcampaigns': {
      const cps = await B.db().collection('bsCampaigns').find({ status: { $ne: 'draft' } }).sort({ createdAt: -1 }).limit(8).toArray()
      if (!cps.length) return say('No campaigns yet.')
      const lines = []
      for (const cp of cps) {
        const r = await B.report(cp._id)
        const errs = Object.entries(r.errorsByReason || {}).map(([k, v]) => `${k} ${v}`).join(', ')
        lines.push(`\n<b>${cp.name || cp._id.slice(-6)}</b> · ${cp.cid}\n  ${r.sent}/${r.total} sent (${r.successPct}%) · ${r.failed} failed · ${r.replies} replies · ⛔ ${r.optOuts} opt-outs${r.skipped ? ` · ${r.skipped} skipped` : ''}\n  cost $${r.cost}${r.costPerReply != null ? ` · $${r.costPerReply}/reply` : ''}${r.throttled ? ` · ⏳ throttled ${r.throttled}×` : ''}${errs ? `\n  errors: ${errs}` : ''}`)
      }
      return say(`📈 <b>Recent campaigns</b> (sent = accepted by Spenza; no carrier delivery data)${lines.join('\n')}`)
    }
    default: return false
  }
}

// Deliver this bot's notices (and refunds) from the shared queue, in each user's language.
function startNotices(bot, db) {
  const col = () => B.db().collection('bsNotify'); BOT = bot
  setInterval(() => askReviews(bot, db).catch(() => {}), 15000)
  setInterval(() => sendPendingTexts(bot, db).catch(() => {}), 30000).unref?.()
  const winback = () => sendWinbacks(bot, db).catch(() => {})
  setTimeout(winback, 60000).unref?.(); setInterval(winback, 3600000).unref?.()
  setInterval(async () => {
    try {
      for (let i = 0; i < 20; i++) {
        const r = await col().findOneAndUpdate({ brand: brand(), sent: false }, { $set: { sent: true, sentAt: new Date() } }, { sort: { at: 1 } })
        const n = r?.value !== undefined ? r.value : r; if (!n) break
        if (n.type === 'refund' && n.amount) await walletOps(db).credit(n.chatId, Number(n.amount))
        if (n.silent) continue
        if (n.type === 'admin') { await T?.notifyAdmin?.(n.text); continue }
        const lang = (await db.collection('state').findOne({ _id: String(n.chatId) }, { projection: { userLanguage: 1 } }).catch(() => null))?.userLanguage || 'en'
        const text = n.key ? t(lang, n.key, ...(n.args || [])) : n.text
        await bot.sendMessage(n.chatId, text, { disable_web_page_preview: true, ...(n.type === 'inbound' && n.canReply !== false ? { reply_markup: { inline_keyboard: [[{ text: t(lang, 'reply_btn'), callback_data: `bse-reply:${n.sessionId}` }]] } } : {}) }).catch(() => {})
      }
    } catch (_) { /* next round */ }
  }, 3000)
}
// Every 30 s: a paid text saved because the wallet was low goes out once the wallet has the $20 minimum again.
async function sendPendingTexts(bot, db) {
  const w = walletOps(db), r2 = (x) => Math.round(x * 100) / 100
  for (const c of await B.duePendingTexts(brand())) {
    if (!(await B.claimPendingText(c._id))) continue
    const pt = c.pendingText, chatId = c.chatId || String(c._id).split(':').slice(1).join(':')
    const lang = pt.lang || await langOf(db, chatId)
    const tell = (text) => bot.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => {})
    if (new Date(pt.expiresAt) < new Date()) { await B.clearPendingText(c._id); await tell(t(lang, 'one_pending_expired', pt.to)); continue }
    const bill = await B.singleTextMode(c._id).catch(() => ({ paid: false }))
    let free = null
    if (bill.paid) {
      const bal = await w.balance(chatId).catch(() => 0)
      if (bal < bill.minBalance) { await B.releasePendingText(c._id); continue }
      free = await B.winbackTake(c._id).catch(() => null)
      if (!free && !(await w.debit(chatId, bill.price))) { await B.releasePendingText(c._id); continue }
    }
    const r = await B.sendOne(c._id, pt.to, pt.message, pt.session || null, { optOut: pt.optOut !== false, unlimited: false })
    await B.clearPendingText(c._id)
    if (r.error) { if (bill.paid) await (free ? B.winbackGive(c._id) : w.credit(chatId, bill.price)).catch(() => {}); await tell(`⚠️ ${errText(lang, r)}`); continue }
    const left = bill.paid ? r2(await w.balance(chatId).catch(() => 0)) : null
    const receipt = free ? `\n${t(lang, 'wb_receipt', { left: free.left, bal: left })}` : bill.paid ? `\n${t(lang, 'one_receipt', { charged: bill.price, bal: left })}` : ''
    await tell(`${t(lang, 'queued', r.segments, !!pt.session)}${receipt}`)
  }
}
// Hourly: paid customers quiet for 7+ days get 2 free single texts (at most once every 30 days, valid 14 days).
async function sendWinbacks(bot, db) {
  for (const o of await B.dueWinbacks(brand())) await bot.sendMessage(o.chatId, t(await langOf(db, o.chatId), 'wb_offer', o.texts, o.days), { parse_mode: 'HTML' }).catch(() => {})
}
const langOf = async (db, chatId) => (await db.collection('state').findOne({ _id: String(chatId) }, { projection: { userLanguage: 1 } }).catch(() => null))?.userLanguage || 'en'
async function askReviews(bot, db) {
  BOT = bot
  for (const r of await B.dueReviews(brand())) {
    const lang = await langOf(db, r.chatId)
    if (r.kind === 'campaign') {
      await bot.sendMessage(r.chatId, t(lang, 'rv_cp_q', r.name), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[1, 2, 3, 4, 5].map(n => ({ text: `${n}⭐`, callback_data: `bse-rv:${r._id}:s:${n}` }))] } }).catch(() => {})
      continue
    }
    const L = { yes: t(lang, 'rv_yes'), spam: t(lang, 'rv_spam'), no: t(lang, 'rv_no'), u: t(lang, 'rv_unsure') }
    await bot.sendMessage(r.chatId, t(lang, 'rv_q', r.to, r.seq), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: L.yes, callback_data: `bse-rv:${r._id}:a:y` }, { text: L.spam, callback_data: `bse-rv:${r._id}:a:s` }], [{ text: L.no, callback_data: `bse-rv:${r._id}:a:n` }, { text: L.u, callback_data: `bse-rv:${r._id}:a:u` }]] } }).catch(() => {})
  }
}
const ARR = { yes: '✅ arrived', spam: '📥 arrived in SPAM', no: '❌ did NOT arrive', not_sure: '🤷 not sure' }
// Review results always go to the @Nomadlybot admin only, whichever of the 4 bots the customer used.
const rvAlert = (text) => B.adminAlert(text)
const rvLine = (r) => r.kind === 'campaign'
  ? `🤖 ${r.cid.split(':')[0]} bot · ${r.cid} · campaign “${r.name}”${r.campaignId ? ` (${r.campaignId})` : ''}`
  : `🤖 ${r.cid.split(':')[0]} bot · ${r.cid} · single text #${r.seq} to ${r.to}${r.from ? ` from ${r.from}` : ''}${r.esimId ? ` (${r.esimId})` : ''} · status ${r.msgStatus || '?'}`
async function onReview(q, { saveInfo, send, lang }) {
  const [, id, field, value] = String(q.data).split(':'), chatId = q.message?.chat?.id, mid = q.message?.message_id, cid = B.cidOf(brand(), chatId)
  const edit = (text, kbd) => BOT?.editMessageText(text, { chat_id: chatId, message_id: mid, parse_mode: 'HTML', ...(kbd ? { reply_markup: { inline_keyboard: kbd } } : {}) }).catch(() => {})
  if (field === 'a') {
    const r = await B.reviewAnswer(id, cid, 'arrived', value); if (!r) return true
    await edit(`${q.message?.text ? esc(q.message.text) + '\n' : ''}<b>${t(lang, { yes: 'rv_yes', spam: 'rv_spam', no: 'rv_no', not_sure: 'rv_unsure' }[r.arrived])}</b>\n\n${t(lang, 'rv_stars')}`, [[1, 2, 3, 4, 5].map(n => ({ text: `${n}⭐`, callback_data: `bse-rv:${id}:s:${n}` }))])
    if (r.arrived === 'no') {
      await send(chatId, t(lang, 'rv_no_note'))
      await rvAlert(`📭 <b>Customer says a single text did NOT arrive</b>\n${rvLine(r)}\n${r.check === 'passed' || r.check === 'pending' ? '🔁 Line check started both ways — a failed check alerts you and runs the replace / new-line process.' : r.check === 'no_peer' ? '⚠️ No other line to check against.' : '⚠️ Sending line unknown or not in service — no check run.'}`)
    }
    return true
  }
  if (field === 's') {
    const r = await B.reviewAnswer(id, cid, 'stars', value); if (!r) return true
    await BOT?.editMessageReplyMarkup({ inline_keyboard: [[{ text: `${'⭐'.repeat(r.stars)} ${t(lang, 'rv_thanks')}`, callback_data: 'noop' }]] }, { chat_id: chatId, message_id: mid }).catch(() => {})
    await rvAlert(r.kind === 'campaign'
      ? `📣 <b>Campaign review</b>: ${'⭐'.repeat(r.stars)} (${r.stars}/5)\n${rvLine(r)}`
      : `${r.arrived === 'no' ? '👎' : '📝'} <b>Single-text review</b>: ${ARR[r.arrived] || '— no answer'} · ${'⭐'.repeat(r.stars)} (${r.stars}/5)\n${rvLine(r)}`)
    const p = await send(chatId, t(lang, 'rv_comment_q'), { reply_markup: { force_reply: true, selective: true } }).catch(() => null)
    if (p?.message_id) { await saveInfo('bseReviewPrompt', p.message_id); await saveInfo('bseReviewId', id) }
    return true
  }
  return true
}
// Inline "Reply" under an incoming text → reply mode.
async function onCallback(q, { set, state, saveInfo, send, lang = 'en' }) {
  if (String(q.data || '').startsWith('bse-rv:')) return onReview(q, { saveInfo, send, lang })
  const sid = String(q.data || '').split(':')[1], chatId = q.message?.chat?.id
  const s = sid && await B.db().collection('bsSessions').findOne({ _id: sid, cid: B.cidOf(brand(), chatId) }); if (!s) return false
  const rr = await B.replyRoute(s.cid, s._id); if (rr.error) { await send(chatId, t(lang, rr.error)); return true }
  await saveInfo('bseTo', s.to); await saveInfo('bseSession', s._id); await set(state, chatId, 'action', 'bse-reply')
  await send(chatId, t(lang, 'replying', s.to), kb([[btn(lang).back]])); return true
}
const homeBtn = (lang) => btn(lang || 'en').home

// Called after a validation or a leads purchase (USA/Canada): keeps the list and offers "Text them now / Schedule / Just the file".
async function offerSend({ chatId, numbers, lang = 'en', fromBulk = false, send }) {
  if (!B.configured() || !numbers?.length) return false
  const cid = B.cidOf(brand(), chatId), c = await B.cfg(), L = btn(lang), list = [...new Set(numbers)].slice(0, c.maxVolume)
  await B.db().collection('bsHandoff').updateOne({ _id: cid }, { $set: { numbers: list, fromBulk: !!fromBulk, at: new Date() } }, { upsert: true })
  await B.saveList(cid, list, 'validator')
  await send(chatId, t(lang, fromBulk ? 'ho_intro_bulk' : 'ho_intro', { n: list.length, pct: c.scheduleDiscountPct, minHours: c.scheduleMinHours }), kb([[L.ho_now], [L.ho_later], [fromBulk ? L.back : L.ho_file]]))
  return true
}

module.exports = { offerSend, askReviews, sendWinbacks, sendPendingTexts, PRODUCT_KEY, BTN, homeBtn, handle, paid, paidFromWallet, showHome: (send, chatId, lang) => home(send, chatId, lang), admin, startNotices, onCallback, brand, init: (o) => { T = o; return B.init(o) } }
