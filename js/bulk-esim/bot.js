'use strict'
// Telegram side of eSIM BulkSMS (USA/Canada): campaign wizard (link/phone choice + content + contacts upload + consent + 2 test texts
// + slot booking + payment), one-off texts, conversations with reply, usage, bookings, progress, help. Every rule lives in core.js.
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
const isHome = (m) => m === '/esimsms' || allLabels('home').includes(m)
let T = null
const drafts = () => B.db().collection('bsDrafts')

async function home(send, chatId, lang) {
  const c = await B.cfg(), u = await B.usage(B.cidOf(brand(), chatId))
  return send(chatId, t(lang, 'home', { min: c.minVolume, max: c.maxVolume, plain: per500(c.pricePlain), link: per500(c.priceLink), tests: c.testSends, used: u.used, limit: u.limit, from: c.quietStart, to: c.quietEnd }), homeKb(btn(lang)))
}
const days = () => Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400000).toISOString().slice(0, 10))

// Returns true when the message was handled here (anything but an explicit false).
const handle = async (ctx) => (await flow(ctx)) !== false
async function flow({ chatId, msg, message, info, set, state, send, saveInfo, goto, bot }) {
  const action = info?.action || '', lang = info?.userLanguage || 'en', L = btn(lang), say = (k, ...a) => t(lang, k, ...a)
  const cid = B.cidOf(brand(), chatId), go = (a) => set(state, chatId, 'action', a), put = (k, v) => saveInfo(k, v), HK = homeKb(L)
  if (isHome(message) && !B.configured()) { await send(chatId, say('soon')); return true }
  if (isHome(message)) { await B.customer(brand(), chatId); await go('bse-home'); await home(send, chatId, lang); return true }
  if (!action.startsWith('bse-')) return false
  if (message === L.back) { if (action === 'bse-home') { await go('none'); return goto.submenu7 ? (await goto.submenu7(), true) : false } await go('bse-home'); await home(send, chatId, lang); return true }
  if (action === 'bse-home') {
    if (message === L.newc) { await go('bse-name'); return send(chatId, say('name_q'), kb([[L.back]])) }
    if (message === L.one) { await go('bse-one-to'); return send(chatId, say('one_to_q'), kb([[L.back]])) }
    if (message === L.usage) { const u = await B.usage(cid); return send(chatId, say('usage', { ...u, reset: u.resetAt.toISOString().slice(0, 16).replace('T', ' ') }), HK) }
    if (message === L.help) { const c = await B.cfg(); return send(chatId, say('help', { from: c.quietStart, to: c.quietEnd }), HK) }
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
  if (action === 'bse-name') { const c = await B.cfg(); await put('bseName', String(message).slice(0, 60)); await go('bse-type'); return send(chatId, say('type_q', per500(c.pricePlain), per500(c.priceLink)), kb([[L.plain], [L.link], [L.back]])) }
  if (action === 'bse-type') {
    if (message !== L.plain && message !== L.link) return send(chatId, say('pick_option'))
    await put('bseLinks', message === L.link); await go('bse-content'); return send(chatId, say('content_q', message === L.link), kb([[L.back]]))
  }
  if (action === 'bse-content') {
    const k = B.checkContent(message, !!info.bseLinks); if (k.error) return send(chatId, `⚠️ ${errText(lang, k)}`)
    await put('bseContent', k.parts); await go('bse-contacts')
    return send(chatId, say('content_ok', k.parts.length, k.segs.join('/')), kb([[L.back]]))
  }
  if (action === 'bse-contacts') {
    let raw = message, fileName = null
    if (msg?.document) {
      const name = msg.document.file_name || ''
      if (!/\.(txt|csv)$/i.test(name) || (msg.document.file_size || 0) > 2e6) return send(chatId, say('file_bad'))
      try { const link = await bot.getFileLink(msg.document.file_id); raw = String((await axios.get(link, { timeout: 20000, responseType: 'text', maxContentLength: 2e6 })).data) } catch (_) { return send(chatId, say('file_bad')) }
      fileName = name
    }
    const r = await B.parseContacts(cid, raw), c = await B.cfg()
    const sg = B.checkContent(info.bseContent, !!info.bseLinks).segs || [1], parts = r.contacts.reduce((a, _, i) => a + sg[i % sg.length], 0)
    if (parts < c.minVolume) return send(chatId, say('contacts_few', { ...r, n: r.contacts.length, parts }, c.minVolume))
    await drafts().updateOne({ _id: cid }, { $set: { contacts: r.contacts, file: fileName ? { name: fileName, raw } : null, at: new Date() } }, { upsert: true })
    await put('bseParsed', { invalid: r.invalid, optedOut: r.optedOut, duplicates: r.duplicates })
    await go('bse-consent'); return send(chatId, say('consent_q', r.contacts.length), kb([[L.agree], [L.back]]))
  }
  if (action === 'bse-consent') {
    if (message !== L.agree) return send(chatId, say('pick_option'))
    const d = await drafts().findOne({ _id: cid }) || {}, f = d.file
    const upload = f ? await saveUpload(B.db(), cid, { name: f.name, data: f.raw }).catch(e => { console.log(`[BulkESIM] upload store: ${e.message}`); return null }) : null
    const cr = await B.createCampaign(cid, { name: info.bseName, content: info.bseContent, contacts: d.contacts || [], withLinks: !!info.bseLinks, consent: true, uploadId: upload?._id })
    if (cr.error) { await go('bse-contacts'); return send(chatId, `⚠️ ${errText(lang, cr)}\n\n${say('contacts_again')}`, kb([[L.back]])) }
    const cp = cr.campaign, c = await B.cfg(), unit = cp.withLinks ? c.priceLink : c.pricePlain
    await put('bseCampaign', cp._id); await drafts().deleteOne({ _id: cid }); await go('bse-test')
    return send(chatId, say('contacts_ok', { n: cp.volume, parts: cp.parts, dropped: cp.dropped, max: c.maxVolume, price: Math.round(cp.parts * unit * 100) / 100, tests: c.testSends, ...info.bseParsed }), kb([[L.test], [L.cont], [L.back]]))
  }
  if (action === 'bse-test') {
    if (message === L.test) { await go('bse-test-to'); return send(chatId, say('test_to_q'), kb([[L.back]])) }
    if (message === L.cont) { await go('bse-day'); return send(chatId, say('day_q'), kb([...days().map(d => [d]), [L.back]])) }
    return false
  }
  if (action === 'bse-test-to') { const r = await B.testSend(cid, info.bseCampaign, message); await go('bse-test'); return send(chatId, r.error ? `⚠️ ${errText(lang, r)}` : say('test_ok', r.left), kb([...(r.left ? [[L.test]] : []), [L.cont], [L.back]])) }
  if (action === 'bse-day') {
    if (!days().includes(message)) return send(chatId, say('pick_option'))
    const { slots, capacity } = await B.availability(message), cp = await B.db().collection('bsCampaigns').findOne({ _id: info.bseCampaign }), c = await B.cfg()
    if (!capacity) return send(chatId, `⚠️ ${say('err_no_lines')}`)
    const open = slots.filter(s => s.free > 0); if (!open.length) return send(chatId, say('no_cap_day'))
    await put('bseDay', message); await go('bse-hour')
    return send(chatId, say('hour_q', message, cp.parts, c.quietStart, c.quietEnd), kb([...open.map(s => [`${String(s.hour).padStart(2, '0')}:00 · ${s.free} ${say('free')}`]), [L.back]]))
  }
  if (action === 'bse-hour') {
    const h = parseInt(String(message), 10); if (!(h >= 0 && h < 24)) return send(chatId, say('pick_option'))
    const r = await B.createBooking(cid, { date: info.bseDay, hour: h, campaignId: info.bseCampaign })
    if (r.error) return send(chatId, `⚠️ ${errText(lang, r)}`)
    const b = r.booking; await put('bseBookingId', b._id); await go('bse-pay')
    const bal = await walletOps(T.db).balance(chatId).catch(() => null), c = await B.cfg()
    return send(chatId, say('booking', { code: b._id.slice(-6), parts: b.volume, date: b.date, hour: String(h).padStart(2, '0'), end: b.estimatedCompletion.toISOString().slice(11, 16), price: b.price, unit: b.unitPrice, wallet: bal != null ? bal.toFixed(2) : null, hold: c.holdMinutes }), kb([[L.wallet], [L.other], [L.back]]))
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
// /bulklimit brand:chatId 3000, /bulksuspend brand:chatId, /bulkrestore brand:chatId, /bulkbookings, /bulkcancel bookingCode, /bulkwebhook, /bulkreport
async function admin(chatId, message, say) {
  const [cmd, a1, ...rest] = String(message).trim().split(/\s+/), by = `admin:${chatId}`, ok = (r) => say(r?.error ? `⚠️ ${r.args ? t('en', r.error, ...r.args) : r.error}` : `✅ Done${r?.esimId || r?.newEsimId ? ` (${r.esimId || r.newEsimId})` : ''}`)
  switch (cmd) {
    case '/bulk': {
      const o = await B.overview(), e = o.esims
      return say(`🛰 <b>eSIM BulkSMS</b>\n${o.paused.length ? `⏸ PAUSED: ${o.paused.join(', ')}` : '▶️ Sending'} · Spenza credit: ${o.credit == null ? '?' : `$${o.credit}`}\neSIMs: ${e.total} total · ${e.active} usable · ${e.testing} testing · ${e.pending} pending · ${e.suspended} suspended · ${e.failed} failed · ${e.replaced} replaced\nCapacity: ${o.capacity.perHour} SMS/hour\nToday: ${Object.entries(o.today).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nothing yet'}\n\n${e.list.map(x => `${x._id} ${x.msisdn || '—'} ${x.status}/${x.health} score ${x.healthScore} · ${x.stats?.sent || 0} sent`).join('\n') || 'No eSIMs yet — /bulkprovision'}`)
    }
    case '/bulkpause': await B.pause('admin', rest.join(' ') || a1 || 'manual'); return say('⏸ Paused.')
    case '/bulkresume': await B.resume('admin'); await B.creditWatch(); return say(`▶️ ${(await B.state()).reasons?.length ? `Still paused: ${(await B.state()).reasons.join(', ')}` : 'Sending.'}`)
    case '/bulkset': return a1 ? ok(await B.setConfig({ [a1]: rest[0] }, by)) : say(`Settings:\n${Object.entries(await B.cfg()).map(([k, v]) => `${k} = ${v}`).join('\n')}`)
    case '/bulkprovision': return ok(await B.provisionOne('admin', by))
    case '/bulktest': await B.healthCheck(); return say('🩺 Health check done. /bulk to see results.')
    case '/bulkreplace': return ok(await B.replaceEsim(a1, rest.join(' ') || 'admin', by))
    case '/bulklimit': return ok(await B.setCustomer(a1, { dailyLimit: rest[0] }, by))
    case '/bulksuspend': return ok(await B.setCustomer(a1, { status: 'suspended' }, by))
    case '/bulkrestore': return ok(await B.setCustomer(a1, { status: 'active' }, by))
    case '/bulkbookings': { const bs = await B.db().collection('bsBookings').find({}).sort({ createdAt: -1 }).limit(15).toArray(); return say(bs.map(b => `${b._id.slice(-6)} ${b.cid} ${b.date} ${b.hour}:00 ${b.volume} SMS $${b.price} ${b.status}`).join('\n') || 'No bookings.') }
    case '/bulkcancel': { const b = await B.db().collection('bsBookings').findOne({ _id: new RegExp(`${String(a1 || '').replace(/\W/g, '')}$`) }); return ok(b ? await B.cancelBooking(b._id, { by: 'admin' }) : { error: 'Booking not found.' }) }
    case '/bulkwebhook': { const r = await B.registerWebhook(process.env.SELF_URL); return say(`Webhook → ${r.url}${r.simulated ? ' (simulated)' : ''}`) }
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
