'use strict'
// Telegram side of eSIM BulkSMS (USA/Canada): campaign wizard (content + contacts upload + 2 test texts + slot booking + payment),
// one-off texts, conversations with reply, usage, bookings, progress/reports, help. Every rule lives in core.js.
// Each bot delivers its own customers' notices (bsNotify) and wallet refunds.
const axios = require('axios')
const B = require('./core')
const { walletOps } = require('../cloudivr-web/wallet')
const { saveUpload } = require('./storage')

const PRODUCT_KEY = 'bulk-esim-sms'
const BTN = { home: '🛰 eSIM BulkSMS (USA/Canada)', newc: '📤 New campaign', one: '✉️ Send one SMS', convs: '💬 Conversations', usage: '📊 Daily usage', bookings: '📅 My bookings', progress: '📈 Campaign progress', help: '❓ Help', back: '↩️ Back', test: '🧪 Send a test SMS', cont: '➡️ Continue to booking', wallet: '💰 Pay from wallet', other: '💳 Pay with crypto / bank', cancelBk: '🗑 Cancel a booking' }
const kb = (rows) => ({ parse_mode: 'HTML', reply_markup: { keyboard: rows, resize_keyboard: true } })
const homeKb = kb([[BTN.newc], [BTN.one, BTN.convs], [BTN.usage, BTN.bookings], [BTN.progress, BTN.help], [BTN.back]])
const brand = () => (process.env.CHAT_BOT_BRAND || 'Nomadly').replace(/[^A-Za-z0-9]/g, '')
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
let T = null

async function home(send, chatId) {
  const c = await B.cfg(), u = await B.usage(B.cidOf(brand(), chatId))
  return send(chatId, `🛰 <b>eSIM BulkSMS — USA & Canada</b>\n\nTexts go out from real USA mobile numbers. Replies come back here.\n\n• Book ${c.minVolume}–${c.maxVolume} SMS per campaign · $${c.pricePerSms}/SMS\n• ${c.testSends} free test texts while you set up a campaign\n• Daily allowance: <b>${u.used}/${u.limit}</b> (${u.unit})\n• Recipients can reply STOP to opt out`, homeKb)
}
const usageText = (u) => `📊 <b>Daily SMS usage</b>\nAllowance: ${u.limit}\nUsed: ${u.used}\nRemaining: ${u.remaining}\nUsage: ${u.pct}%\nNext reset: ${u.resetAt.toISOString().slice(0, 16).replace('T', ' ')} UTC\nCounted as: ${u.unit}`
const days = () => Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400000).toISOString().slice(0, 10))

// Returns true when the message was handled here (anything but an explicit false).
const handle = async (ctx) => (await flow(ctx)) !== false
async function flow({ chatId, msg, message, info, set, state, send, saveInfo, goto, bot }) {
  const action = info?.action || ''
  const cid = B.cidOf(brand(), chatId), go = (a) => set(state, chatId, 'action', a), put = (k, v) => saveInfo(k, v)
  if ((message === BTN.home || message === '/esimsms') && !B.configured()) { await send(chatId, '🛰 eSIM BulkSMS for USA & Canada is coming soon to this bot.'); return true }
  if (message === BTN.home || message === '/esimsms') { await B.customer(brand(), chatId); await go('bse-home'); await home(send, chatId); return true }
  if (!action.startsWith('bse-')) return false
  if (message === BTN.back) { if (action === 'bse-home') { await go('none'); return goto.submenu7 ? (await goto.submenu7(), true) : false } await go('bse-home'); await home(send, chatId); return true }
  if (action === 'bse-home') {
    if (message === BTN.newc) { await go('bse-name'); return send(chatId, '📝 Name this campaign (only you see it):', kb([[BTN.back]])) }
    if (message === BTN.one) { await go('bse-one-to'); return send(chatId, '📞 Number to text (USA/Canada, e.g. +12125550123):', kb([[BTN.back]])) }
    if (message === BTN.usage) return send(chatId, usageText(await B.usage(cid)), homeKb)
    if (message === BTN.help) return send(chatId, '❓ <b>How it works</b>\n1. New campaign → name, message (use <code>---</code> between versions to rotate), contacts (paste or upload .txt/.csv).\n2. Send up to 2 test texts to yourself.\n3. Pick a day and start hour (UTC) with free capacity, then pay.\n4. Sending starts at your slot; replies and opt-outs arrive here.\n\nOnly text people who agreed to hear from you. STOP opt-outs are enforced automatically.', homeKb)
    if (message === BTN.convs) {
      const ss = await B.db().collection('bsSessions').find({ cid, status: 'active' }).sort({ lastActivityAt: -1 }).limit(10).toArray()
      if (!ss.length) return send(chatId, 'No conversations yet.', homeKb)
      await go('bse-conv'); return send(chatId, '💬 Pick a conversation:', kb([...ss.map(s => [`💬 ${s.to}`]), [BTN.back]]))
    }
    if (message === BTN.bookings) {
      const bs = await B.db().collection('bsBookings').find({ cid }).sort({ createdAt: -1 }).limit(10).toArray()
      const txt = bs.length ? bs.map(b => `• <code>${b._id.slice(-6)}</code> ${b.date} ${String(b.hour).padStart(2, '0')}:00 UTC · ${b.volume} SMS · $${b.price} · <b>${b.status}</b>`).join('\n') : 'No bookings yet.'
      return send(chatId, `📅 <b>My bookings</b>\n${txt}`, kb([...(bs.some(b => ['awaiting_payment', 'scheduled', 'confirmed', 'provisioning'].includes(b.status)) ? [[BTN.cancelBk]] : []), [BTN.back]]))
    }
    if (message === BTN.cancelBk) { await go('bse-cancel'); return send(chatId, 'Send the 6-character booking code to cancel:', kb([[BTN.back]])) }
    if (message === BTN.progress) {
      const cps = await B.db().collection('bsCampaigns').find({ cid, status: { $ne: 'draft' } }).sort({ createdAt: -1 }).limit(5).toArray()
      if (!cps.length) return send(chatId, 'No campaigns booked yet.', homeKb)
      const lines = []; for (const cp of cps) { const r = await B.report(cp._id); lines.push(`📈 <b>${esc(cp.name)}</b> — ${cp.status}\n   ${r.sent}/${r.total} sent · ${r.failed} failed · ${r.rejected} skipped · ${r.queued} waiting · ${r.replies} replies · ${r.successPct}% success`) }
      return send(chatId, `${lines.join('\n\n')}\n\n<i>“Sent” = accepted by the carrier network. The provider doesn’t report handset delivery.</i>`, homeKb)
    }
    return home(send, chatId)
  }
  if (action === 'bse-cancel') { const b = await B.db().collection('bsBookings').findOne({ cid, _id: new RegExp(`${String(message).trim().replace(/\W/g, '')}$`) }); const r = b ? await B.cancelBooking(b._id, { cid }) : { error: 'Booking not found.' }; await go('bse-home'); return send(chatId, r.error ? `⚠️ ${r.error}` : `✅ Cancelled.${r.refunded ? ` $${r.refunded} goes back to your wallet.` : ''}`, homeKb) }
  if (action === 'bse-name') { await put('bseName', String(message).slice(0, 60)); await go('bse-content'); return send(chatId, '✍️ Type the message. To rotate versions, separate them with a line containing only <code>---</code>. Max 3 SMS parts each.', kb([[BTN.back]])) }
  if (action === 'bse-content') {
    const parts = String(message).split(/\n?---\n?/).map(x => x.trim()).filter(Boolean)
    if (!parts.length) return send(chatId, 'Type the message text.')
    if (parts.some(p => B.segs(p) > 3)) return send(chatId, '⚠️ A version is longer than 3 SMS parts (~459 characters). Shorten it.')
    await put('bseContent', parts); await go('bse-contacts')
    return send(chatId, `✅ ${parts.length} version(s), ${parts.map(p => B.segs(p)).join('/')} SMS part(s).\n\n📇 Now send the contacts: paste numbers (one per line) or upload a .txt / .csv file. USA & Canada only.`, kb([[BTN.back]]))
  }
  if (action === 'bse-contacts') {
    let raw = message
    let fileName = null
    if (msg?.document) {
      const name = msg.document.file_name || ''
      if (!/\.(txt|csv)$/i.test(name) || (msg.document.file_size || 0) > 2e6) return send(chatId, '⚠️ Send a .txt or .csv file under 2 MB.')
      try { const link = await bot.getFileLink(msg.document.file_id); raw = String((await axios.get(link, { timeout: 20000, responseType: 'text', maxContentLength: 2e6 })).data) } catch (_) { return send(chatId, '⚠️ Couldn’t read that file. Send a .txt or .csv under 2 MB.') }
      fileName = name
    }
    const r = await B.parseContacts(cid, raw), c = await B.cfg()
    if (r.contacts.length < c.minVolume) return send(chatId, `⚠️ Found ${r.contacts.length} valid USA/Canada number(s)${r.invalid ? `, ${r.invalid} invalid` : ''}${r.optedOut ? `, ${r.optedOut} opted out` : ''}. A campaign needs at least ${c.minVolume}. Send more numbers.`)
    const upload = fileName ? await saveUpload(B.db(), cid, { name: fileName, data: raw }).catch(e => { console.log(`[BulkESIM] upload store: ${e.message}`); return null }) : null
    const list = r.contacts.slice(0, c.maxVolume)
    const cr = await B.createCampaign(cid, { name: info.bseName, content: info.bseContent, contacts: list, uploadId: upload?._id }); if (cr.error) return send(chatId, `⚠️ ${cr.error}`)
    await put('bseCampaign', cr.campaign._id); await go('bse-test')
    return send(chatId, `✅ <b>${list.length}</b> contacts ready${r.contacts.length > list.length ? ` (first ${c.maxVolume} kept — the maximum per campaign)` : ''}${r.invalid ? ` · ${r.invalid} invalid skipped` : ''}${r.optedOut ? ` · ${r.optedOut} opted out skipped` : ''}.\n\nSend up to ${c.testSends} test texts to your own phone first?`, kb([[BTN.test], [BTN.cont], [BTN.back]]))
  }
  if (action === 'bse-test') {
    if (message === BTN.test) { await go('bse-test-to'); return send(chatId, '📞 Your test number (+1…):', kb([[BTN.back]])) }
    if (message === BTN.cont) { await go('bse-day'); return send(chatId, '📅 Pick a day (times are UTC):', kb([...days().map(d => [d]), [BTN.back]])) }
    return false
  }
  if (action === 'bse-test-to') { const r = await B.testSend(cid, info.bseCampaign, message); await go('bse-test'); return send(chatId, r.error ? `⚠️ ${r.error}` : `🧪 Test queued — it arrives within a minute. ${r.left} test(s) left.`, kb([...(r.left ? [[BTN.test]] : []), [BTN.cont], [BTN.back]])) }
  if (action === 'bse-day') {
    if (!days().includes(message)) return send(chatId, 'Pick one of the days.')
    const { slots } = await B.availability(message), cp = await B.db().collection('bsCampaigns').findOne({ _id: info.bseCampaign })
    const open = slots.filter(s => s.free > 0); if (!open.length) return send(chatId, '⚠️ No capacity left that day. Pick another day.')
    await put('bseDay', message); await put('bseVolume', cp.volume); await go('bse-hour')
    return send(chatId, `🕐 Start hour on ${message} (UTC). Free capacity per hour shown. Your campaign: ${cp.volume} SMS (it may run over several hours).`, kb([...open.map(s => [`${String(s.hour).padStart(2, '0')}:00 · ${s.free} free`]), [BTN.back]]))
  }
  if (action === 'bse-hour') {
    const h = parseInt(String(message), 10); if (!(h >= 0 && h < 24)) return send(chatId, 'Pick an hour from the list.')
    const r = await B.createBooking(cid, { date: info.bseDay, hour: h, volume: info.bseVolume, campaignId: info.bseCampaign })
    if (r.error) return send(chatId, `⚠️ ${r.error}`)
    const b = r.booking; await put('bseBookingId', b._id); await go('bse-pay')
    const bal = await walletOps(T.db).balance(chatId).catch(() => null)
    return send(chatId, `🧾 <b>Booking ${b._id.slice(-6)}</b>\n${b.volume} SMS · ${b.date} from ${String(h).padStart(2, '0')}:00 UTC · ends ~${b.estimatedCompletion.toISOString().slice(11, 16)} UTC\nTotal: <b>$${b.price}</b>${bal != null ? ` · wallet $${bal.toFixed(2)}` : ''}\n\nThe slot is held for 15 minutes while you pay.`, kb([[BTN.wallet], [BTN.other], [BTN.back]]))
  }
  if (action === 'bse-pay') {
    const b = await B.db().collection('bsBookings').findOne({ _id: info.bseBookingId, cid }); if (!b) return send(chatId, 'Booking not found.', homeKb)
    if (message === BTN.wallet) {
      const w = walletOps(T.db)
      if (!(await w.debit(chatId, b.price))) return send(chatId, `⚠️ Your wallet needs $${b.price}. Top up, or pay with crypto / bank.`)
      const r = await B.confirmBooking(b._id, { method: 'wallet', amount: b.price })
      if (r.error) { await w.credit(chatId, b.price); return send(chatId, `⚠️ ${r.error} You weren’t charged.`, homeKb) }
      await go('bse-home'); return true
    }
    if (message === BTN.other) { await put('dpProductKey', PRODUCT_KEY); await put('dpProductName', `eSIM BulkSMS ${b.volume} SMS`); await put('dpPrice', b.price); await go('none'); await goto['digital-product-pay'](); return true }
    return false
  }
  if (action === 'bse-one-to') { if (!/^\+?1?\d{10}$/.test(String(message).replace(/[\s()-]/g, ''))) return send(chatId, 'Enter +1 and the 10-digit number.'); await put('bseTo', message); await go('bse-one-text'); return send(chatId, '✍️ Type the text:', kb([[BTN.back]])) }
  if (action === 'bse-one-text' || action === 'bse-reply') {
    const r = await B.sendOne(cid, info.bseTo, message, action === 'bse-reply' ? info.bseSession : null)
    if (r.error) return send(chatId, `⚠️ ${r.error}`)
    if (action === 'bse-one-text') await go('bse-home')
    return send(chatId, `✉️ Sent to the queue (${r.segments} part${r.segments > 1 ? 's' : ''}). ${action === 'bse-reply' ? 'Keep typing to reply again, or ↩️ Back.' : ''}`, action === 'bse-reply' ? kb([[BTN.back]]) : homeKb)
  }
  if (action === 'bse-conv') {
    const to = String(message).replace(/^💬\s*/, ''), s = await B.db().collection('bsSessions').findOne({ cid, to })
    if (!s) return send(chatId, 'Pick a conversation from the list.')
    const ms = await B.db().collection('bsMessages').find({ cid, $or: [{ to }, { from: to }] }).sort({ createdAt: -1 }).limit(10).toArray()
    await put('bseTo', to); await put('bseSession', s._id); await go('bse-reply')
    return send(chatId, `💬 <b>${to}</b>\n${ms.reverse().map(m => `${m.direction === 'in' ? '⬅️' : '➡️'} ${esc(m.body).slice(0, 300)}${m.direction === 'out' ? ` <i>(${m.status})</i>` : ''}`).join('\n')}\n\nType a reply:`, kb([[BTN.back]]))
  }
  return false
}

// Crypto / bank checkout finished: money is in hand for this booking.
async function paid(chatId, info, amount, method) {
  const r = await B.confirmBooking(info?.bseBookingId, { method, amount })
  if (r.error) { await walletOps(T.db).credit(chatId, Number(amount)); return { ok: false, text: `⚠️ ${r.error} $${amount} was added to your wallet instead.` } }
  return { ok: true, text: '✅ Payment received. Your booking is confirmed.' }
}

// Wallet chosen on the shared checkout screen.
async function paidFromWallet(chatId, info, price) {
  const w = walletOps(T.db)
  if (!(await w.debit(chatId, price))) return { ok: false, text: `⚠️ Your wallet needs $${price}.` }
  const r = await B.confirmBooking(info?.bseBookingId, { method: 'wallet', amount: price })
  if (r.error) { await w.credit(chatId, price); return { ok: false, text: `⚠️ ${r.error} You weren’t charged.` } }
  return { ok: true, text: '✅ Paid from your wallet. Your booking is confirmed.' }
}

// Admin commands (bot admins only): /bulk, /bulkpause, /bulkresume, /bulkset key value, /bulkprovision, /bulktest, /bulkreplace ESIM-0001 reason,
// /bulklimit brand:chatId 3000, /bulksuspend brand:chatId, /bulkrestore brand:chatId, /bulkbookings, /bulkcancel bookingCode, /bulkwebhook, /bulkreport
async function admin(chatId, message, say) {
  const [cmd, a1, ...rest] = String(message).trim().split(/\s+/), by = `admin:${chatId}`, ok = (r) => say(r?.error ? `⚠️ ${r.error}` : `✅ Done${r?.esimId || r?.newEsimId ? ` (${r.esimId || r.newEsimId})` : ''}`)
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

// Deliver this bot's notices (and refunds) from the shared queue.
function startNotices(bot, db) {
  const col = () => B.db().collection('bsNotify')
  setInterval(async () => {
    try {
      for (let i = 0; i < 20; i++) {
        const r = await col().findOneAndUpdate({ brand: brand(), sent: false }, { $set: { sent: true, sentAt: new Date() } }, { sort: { at: 1 } })
        const n = r?.value !== undefined ? r.value : r; if (!n) break
        if (n.type === 'refund' && n.amount) await walletOps(db).credit(n.chatId, Number(n.amount))
        await bot.sendMessage(n.chatId, n.text, { disable_web_page_preview: true, ...(n.type === 'inbound' ? { reply_markup: { inline_keyboard: [[{ text: '↩️ Reply', callback_data: `bse-reply:${n.sessionId}` }]] } } : {}) }).catch(() => {})
      }
    } catch (_) { /* next round */ }
  }, 3000)
}
// Inline "Reply" under an incoming text → reply mode.
async function onCallback(q, { set, state, saveInfo, send }) {
  const sid = String(q.data || '').split(':')[1], chatId = q.message?.chat?.id
  const s = sid && await B.db().collection('bsSessions').findOne({ _id: sid, cid: B.cidOf(brand(), chatId) }); if (!s) return false
  await saveInfo('bseTo', s.to); await saveInfo('bseSession', s._id); await set(state, chatId, 'action', 'bse-reply')
  await send(chatId, `↩️ Replying to ${s.to}. Type your message:`, kb([[BTN.back]])); return true
}

module.exports = { PRODUCT_KEY, BTN, handle, paid, paidFromWallet, admin, startNotices, onCallback, brand, init: (o) => { T = o; return B.init(o) } }
