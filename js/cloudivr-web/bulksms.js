'use strict'
// CloudIVR web BulkSMS (USA/Canada) on the shared eSIM pool: same engine, rules and prices as the bots (bulk-esim/core).
// Customer id = `CloudIVR:<webChatId>`; paid from the CloudIVR wallet; notices land in the web inbox (notify.push).
const B = require('../bulk-esim/core')
const { t } = require('../bulk-esim/i18n')
const { logTransaction } = require('../transaction-id.js')
const notify = require('./notify')

const BRAND = 'CloudIVR'
const r2 = (x) => Math.round(Number(x) * 100) / 100
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const msgOf = (r) => plain(t('en', r.error, ...(r.args || [])))
const cidOf = (req) => B.cidOf(BRAND, req.webChatId)
// Common scam texts the engine's link screen lets through (seen on the pool in Nov 2026): fake prizes, Interac / e-Transfer,
// tax-office refunds, locked bank accounts, failed parcels. Refused before a campaign or single text is made.
const SCAM = [
  [/\b(you(['’]ve| have)? won|winner|giveaway|lottery|jackpot|claim (your )?(prize|reward|code)|cash prize)\b/i, 'prize or giveaway claims'],
  [/\b(interac|e-?transfer)\b/i, 'Interac / e-Transfer notices'],
  [/\b(CRA|IRS|revenue canada|tax (return|refund)).{0,40}\b(reassess|refund|owe|claim|deposit)/i, 'tax-office refund notices'],
  [/\b(account|card)\b.{0,30}\b(locked|suspended|frozen|on hold|deactivated)\b/i, 'locked-account warnings'],
  [/\b(package|parcel|delivery|shipment)\b.{0,40}\b(failed|on hold|redeliver|unpaid|customs fee)\b/i, 'parcel-fee notices'],
]
const scamOf = (parts) => { const hit = SCAM.find(([re]) => parts.some(p => re.test(p))); return hit ? { error: 'scam', message: `This looks like a scam text (${hit[1]}) and can't be sent. If it's a genuine message from your business, contact support.` } : null }

function createBulkSms({ db, h, walletOps, log = console.log }) {
  const w = walletOps(db)
  const rec = (chatId, type, amount) => logTransaction(db, { chatId, type, amount: Math.round(Number(amount) * 10000) / 10000, currency: 'USD', status: 'completed', metadata: { product: 'bulk-esim-sms', via: 'web' } }).catch(() => {})
  const debit = async (c, a) => { const ok = await w.debit(c, a); if (ok && a > 0) rec(c, 'bulksms-payment', a); return ok }
  const credit = async (c, a) => { await w.credit(c, a); if (a > 0) rec(c, 'bulksms-refund', a) }
  const drafts = () => B.db().collection('bsDrafts')
  const fail = (res, r, code = 400) => res.status(code).json({ error: r.error, message: msgOf(r) })
  const bad = (res, error, message, code = 400) => res.status(code).json({ error, message })
  const on = (req, res, next) => (B.configured() && B.db() ? next() : bad(res, 'off', 'Bulk SMS is not available right now.', 503))
  const unit = (c, links) => (links ? c.priceLink : c.pricePlain)
  const campaignOf = (cid, id) => B.db().collection('bsCampaigns').findOne({ _id: id, cid })
  const price = async (cp) => { const c = await B.cfg(); return r2(cp.parts * unit(c, cp.withLinks) + (cp.replies ? c.replyFee : 0)) }
  const pub = (cp) => ({ id: cp._id, name: cp.name, status: cp.status, volume: cp.volume, parts: cp.parts, content: cp.content, withLinks: !!cp.withLinks, replies: !!cp.replies, optOut: cp.optOut !== false, createdAt: cp.createdAt, stats: cp.stats || null })

  // Single text / reply: free intro texts, then $1 each with a $20 wallet minimum (charged on send, refunded on failure).
  async function sendSingle(req, to, text, sessionId, optOut) {
    const cid = cidOf(req), chatId = req.webChatId, bill = await B.singleTextMode(cid).catch(() => ({ paid: false }))
    let free = null
    if (bill.paid) {
      const bal = await w.balance(chatId).catch(() => 0)
      if (bal >= bill.minBalance) free = await B.winbackTake(cid).catch(() => null)
      if (bal < bill.minBalance || (!free && !(await debit(chatId, bill.price)))) return { error: 'low_balance', message: `Single texts cost $${bill.price} each and need at least $${bill.minBalance} in your wallet (you have $${r2(bal)}). Top up and send again.` }
    }
    const scam = scamOf([String(text || '')]); if (scam) { if (bill.paid) await (free ? B.winbackGive(cid) : credit(chatId, bill.price)).catch(() => {}); return scam }
    const r = await B.sendOne(cid, to, text, sessionId, { optOut: optOut !== false })
    if (r.error) { if (bill.paid) await (free ? B.winbackGive(cid) : credit(chatId, bill.price)).catch(() => {}); return { error: r.error, message: msgOf(r) } }
    return { ok: true, segments: r.segments, charged: bill.paid && !free ? bill.price : 0, freeLeft: free ? free.left : bill.paid ? null : r.left ?? null, balance: r2(await w.balance(chatId).catch(() => 0)) }
  }

  function routes(r) {
    r.use('/bulksms', on)
    r.get('/bulksms', h(async (req, res) => {
      const cid = cidOf(req)
      await B.customer(BRAND, req.webChatId, { firstName: req.webUser?.name || req.webUser?.email })
      const c = await B.cfg(), cps = await B.db().collection('bsCampaigns').find({ cid, status: { $ne: 'draft' } }).sort({ createdAt: -1 }).limit(20).toArray()
      const bookings = await B.db().collection('bsBookings').find({ cid }).sort({ createdAt: -1 }).limit(20).toArray()
      const campaigns = []
      for (const cp of cps) { const b = bookings.find(x => x.campaignId === cp._id); campaigns.push({ ...pub(cp), report: await B.report(cp._id).catch(() => null), booking: b ? { id: b._id, code: b._id.slice(-6), status: b.status, date: b.date, hour: b.hour, price: b.price, end: b.estimatedCompletion } : null }) }
      const bill = await B.singleTextMode(cid).catch(() => ({ paid: false }))
      res.json({ ready: await B.ready(), window: await B.sendWindow(), usage: await B.usage(cid), balance: r2(await w.balance(req.webChatId).catch(() => 0)),
        prices: { plain: c.pricePlain, link: c.priceLink, minVolume: c.minVolume, maxVolume: c.maxVolume, replyFee: c.replyFee, discountPct: c.scheduleDiscountPct, discountHours: c.scheduleMinHours, quietStart: c.quietStart, quietEnd: c.quietEnd, sessionHours: c.sessionHours },
        single: { paid: !!bill.paid, price: bill.price || null, minBalance: bill.minBalance || null, freeLeft: bill.paid ? null : await B.oneLeft(cid).catch(() => null) },
        lists: (await B.savedLists(cid)).map(l => ({ id: l._id, name: l.name, n: l.n, at: l.at })), campaigns,
        reviews: (await B.db().collection('bsReviews').find({ cid, status: 'asked' }).sort({ askedAt: -1 }).limit(5).toArray()).map(x => ({ id: String(x._id), kind: x.kind, to: x.to || null, seq: x.seq || null, name: x.name || null, arrived: x.arrived || null })) })
    }))

    // Step 1 — numbers (paste / CSV text or a saved list): parsed, free line-type check, kept as this account's draft.
    r.post('/bulksms/contacts', h(async (req, res) => {
      const cid = cidOf(req), c = await B.cfg(), b = req.body || {}
      let raw = String(b.raw || '')
      if (b.listId) { const l = (await B.savedLists(cid)).find(x => x._id === b.listId); if (!l) return bad(res, 'not_found', 'That list has expired.'); raw = l.numbers.join('\n') }
      if (!raw.trim()) return bad(res, 'empty', 'Paste or upload your numbers.')
      const p = await B.parseContacts(cid, raw, { plusOne: !!b.plusOne })
      if (p.noCode && !b.plusOne && !b.skipNoCode) return res.json({ needPlusOne: true, noCode: p.noCode, found: p.contacts.length })
      if (p.contacts.length < c.minVolume) return bad(res, 'too_few', `Found ${p.contacts.length} USA/Canada mobile numbers — a campaign needs at least ${c.minVolume}.`)
      const list = p.contacts.slice(0, c.maxVolume), k = await B.checkNumbers(cid, list)
      if (!k.sendable) return bad(res, 'no_mobile', msgOf({ error: 'err_no_mobile' }))
      await drafts().updateOne({ _id: cid }, { $set: { contacts: list, skip: k.skip, file: null, validated: false, validate: false, at: new Date() } }, { upsert: true })
      if (b.saveAs) await B.saveList(cid, list, 'web', String(b.saveAs).slice(0, 40))
      res.json({ ok: true, n: list.length, dropped: p.contacts.length - list.length, sendable: k.sendable, skipped: k.skip.length, counts: k.counts, invalid: p.invalid, duplicates: p.duplicates, optedOut: p.optedOut, fixed: p.fixed || 0, noCode: b.skipNoCode ? p.noCode : 0 })
    }))
    r.post('/bulksms/lists/:id/rename', h(async (req, res) => { await B.renameList(cidOf(req), req.params.id, req.body?.name || ''); res.json({ ok: true }) }))

    // Step 2 — message check (opt-out line, links → link price, scam / link screening); then the campaign is made from the draft.
    r.post('/bulksms/content', h(async (req, res) => {
      const cid = cidOf(req), optOut = req.body?.optOut !== false, k = B.checkContent(String(req.body?.text || ''), undefined, optOut)
      if (k.error) return fail(res, k)
      const scam = scamOf(k.parts); if (scam) return res.status(400).json(scam)
      const sc = await B.screenContent(cid, k.parts); if (sc.error) return fail(res, sc)
      const c = await B.cfg(), d = await drafts().findOne({ _id: cid }) || {}, links = k.parts.some(B.hasLinkOrPhone), n = (d.contacts || []).length
      res.json({ ok: true, parts: k.parts, links, found: [...new Set(k.parts.flatMap(B.linksIn))], unchecked: !!sc.unchecked, n, unit: unit(c, links), price: r2(n * unit(c, links)) })
    }))
    r.post('/bulksms/campaigns', h(async (req, res) => {
      const cid = cidOf(req), b = req.body || {}, d = await drafts().findOne({ _id: cid })
      if (!d?.contacts?.length) return bad(res, 'no_numbers', 'Add your numbers first.')
      if (b.consent !== true) return bad(res, 'consent', 'Confirm every number agreed to get your texts.', 428)
      const optOut = b.optOut !== false, k = B.checkContent(String(b.text || ''), undefined, optOut)
      if (k.error) return fail(res, k)
      const scam = scamOf(k.parts); if (scam) { B.adminAlert(`🚫 Web Bulk SMS scam text refused — ${cidOf(req)}: “${k.parts[0].slice(0, 160)}”`); return res.status(400).json(scam) }
      const sc = await B.screenContent(cid, k.parts); if (sc.error) return fail(res, sc)
      const cr = await B.createCampaign(cid, { name: String(b.name || k.parts[0]).slice(0, 40), content: k.parts, contacts: d.contacts, skip: d.skip || [], linksUnchecked: !!sc.unchecked, optOut, consent: true })
      if (cr.error) return fail(res, cr)
      await drafts().deleteOne({ _id: cid })
      const c = await B.cfg(), o = await B.testOffer(cid)
      res.json({ ok: true, campaign: { ...pub(cr.campaign), price: await price(cr.campaign), unit: unit(c, cr.campaign.withLinks) }, test: { free: o.free, barred: !!o.barred, perDay: c.testsPerDay, on: !!(await B.ready()).test } })
    }))
    r.get('/bulksms/campaigns/:id', h(async (req, res) => {
      const cp = await campaignOf(cidOf(req), req.params.id); if (!cp) return bad(res, 'not_found', 'Campaign not found.', 404)
      res.json({ campaign: { ...pub(cp), price: await price(cp) }, report: await B.report(cp._id) })
    }))

    // Step 3 — optional test to the customer's own phone (first one free; later ones charged, credited back when the campaign is paid).
    r.post('/bulksms/campaigns/:id/test', h(async (req, res) => {
      const cid = cidOf(req), chatId = req.webChatId, cp = await campaignOf(cid, req.params.id); if (!cp) return bad(res, 'not_found', 'Campaign not found.', 404)
      const o = await B.testOffer(cid); if (o.barred) return fail(res, { error: 'err_test_guard' })
      if (!o.free) { const need = await price(cp), bal = await w.balance(chatId).catch(() => 0); if (bal < need) return bad(res, 'test_locked', `Tests after your first free one need the campaign price ($${need}) in your wallet — you have $${r2(bal)}.`, 402) }
      const k = await B.testCheck(cid, cp._id, String(req.body?.to || ''), {}); if (k.error) return fail(res, k)
      if (k.charge && !(await debit(chatId, k.charge))) return bad(res, 'low_balance', `A test costs $${k.charge}. Top up your wallet first.`, 402)
      const s = await B.testSend(cid, cp._id, k.to, { charge: k.charge }); if (s.error) { if (k.charge) await credit(chatId, k.charge); return fail(res, s) }
      res.json({ ok: true, messageId: s.messageId, to: k.to, charged: k.charge || 0 })
    }))
    r.post('/bulksms/campaigns/:id/test-feedback', h(async (req, res) => {
      const cid = cidOf(req), a = req.body?.answer, f = await B.testFeedback(cid, String(req.body?.messageId || ''), a === 'yes' ? true : a === 'no' ? false : 'spam')
      if (f.error) return fail(res, f)
      if (f.wait) return res.json({ wait: true, message: 'Give it two minutes — texts can take a moment to arrive.' })
      if (a === 'yes') return res.json({ ok: true })
      const tp = await B.aiTips(cid, req.params.id).catch(() => ({}))
      res.json({ ok: true, risky: tp.risky || [], rewrite: tp.rewrite || null })
    }))

    // Step 4 — when (now / later today / a scheduled day, cheaper 24 h+ ahead), optional paid replies, then pay from the wallet.
    r.get('/bulksms/campaigns/:id/when', h(async (req, res) => { const x = await B.whenOptions(cidOf(req), req.params.id); return x.error ? fail(res, x) : res.json(x) }))
    r.post('/bulksms/campaigns/:id/replies', h(async (req, res) => { await B.setReplies(cidOf(req), req.params.id, !!req.body?.on); res.json(await B.whenOptions(cidOf(req), req.params.id)) }))
    r.get('/bulksms/availability', h(async (req, res) => {
      const date = String(req.query.date || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad(res, 'date', 'Pick a day.')
      const cp = await campaignOf(cidOf(req), String(req.query.campaignId || '')), a = await B.availability(date)
      const next = cp && (!a.capacity || a.dayFree < cp.parts) ? await B.nextFreeDay(cp.parts, date) : null
      res.json({ date, capacity: a.capacity, dayFree: a.dayFree, slots: a.slots.filter(s => s.free > 0).map(s => ({ hour: s.hour, free: s.free })), next: next?.date || null })
    }))
    r.post('/bulksms/campaigns/:id/book', h(async (req, res) => {
      const b = req.body || {}, opts = b.now ? { now: true } : { date: String(b.date || new Date().toISOString().slice(0, 10)), hour: Number(b.hour) }
      const x = await B.createBooking(cidOf(req), { campaignId: req.params.id, ...opts }); if (x.error) return fail(res, x)
      const k = x.booking
      res.json({ booking: { id: k._id, code: k._id.slice(-6), date: k.date, hour: k.hour, end: k.estimatedCompletion, price: k.price, unit: k.unitPrice, volume: k.volume, replyFee: k.replyFee || 0, discountPct: k.discountPct || 0, listPrice: k.listPrice, mode: k.mode, holdMinutes: (await B.cfg()).holdMinutes } })
    }))
    r.post('/bulksms/bookings/:id/pay', h(async (req, res) => {
      const cid = cidOf(req), chatId = req.webChatId, k = await B.db().collection('bsBookings').findOne({ _id: req.params.id, cid }); if (!k) return bad(res, 'not_found', 'Booking not found.', 404)
      if (!(await debit(chatId, k.price))) return bad(res, 'low_balance', `This campaign costs $${k.price}. Top up your wallet and pay again (the slot is held ${(await B.cfg()).holdMinutes} minutes).`, 402)
      const x = await B.confirmBooking(k._id, { method: 'wallet', amount: k.price })
      if (x.error) { await credit(chatId, k.price); return bad(res, x.error, `${msgOf(x)} You were not charged.`) }
      res.json({ ok: true, balance: r2(await w.balance(chatId).catch(() => 0)) })
    }))
    r.post('/bulksms/bookings/:id/cancel', h(async (req, res) => { const x = await B.cancelBooking(req.params.id, { cid: cidOf(req) }); return x.error ? fail(res, x) : res.json({ ok: true, ...x }) }))

    // Reviews — same as the bot: a single text is reviewed (arrived? + stars) before more single texts; campaigns get stars.
    r.post('/bulksms/reviews/:id', h(async (req, res) => {
      const cid = cidOf(req), id = req.params.id, b = req.body || {}
      if (b.arrived) {
        const x = await B.reviewAnswer(id, cid, 'arrived', { yes: 'y', spam: 's', no: 'n', not_sure: 'u' }[b.arrived] || 'u'); if (!x) return bad(res, 'not_found', 'Review not found.', 404)
        if (x.arrived === 'no') B.adminAlert(`📭 <b>Customer says a single text did NOT arrive</b>\n🌐 CloudIVR web · ${cid} · single text #${x.seq} to ${x.to}${x.from ? ` from ${x.from}` : ''}${x.esimId ? ` (${x.esimId})` : ''}\n${x.check === 'passed' || x.check === 'pending' ? '🔁 Line check started both ways.' : '⚠️ No line check run.'}`)
      }
      if (b.stars) {
        const x = await B.reviewAnswer(id, cid, 'stars', Number(b.stars)); if (!x) return bad(res, 'not_found', 'Review not found.', 404)
        const ARR = { yes: '✅ arrived', spam: '📥 arrived in SPAM', no: '❌ did NOT arrive', not_sure: '🤷 not sure' }
        B.adminAlert(x.kind === 'campaign' ? `📣 <b>Campaign review</b>: ${'⭐'.repeat(x.stars)} (${x.stars}/5)\n🌐 CloudIVR web · ${cid} · “${x.name}”` : `${x.arrived === 'no' ? '👎' : '📝'} <b>Single-text review</b>: ${ARR[x.arrived] || '— no answer'} · ${'⭐'.repeat(x.stars)} (${x.stars}/5)\n🌐 CloudIVR web · ${cid} · single text #${x.seq} to ${x.to}`)
        if (require('../bulk-esim/review-post').positive(x)) await B.db().collection('bsNotify').insertOne({ brand: 'Nomadly', type: 'channel', review: { _id: String(x._id), kind: x.kind, stars: x.stars, arrived: x.arrived, to: x.to }, sent: false, at: new Date() }).catch(() => {})
      }
      if (b.comment) await B.reviewAnswer(id, cid, 'comment', String(b.comment).slice(0, 1000))
      res.json({ ok: true, single: await B.singleTextMode(cid).catch(() => ({ paid: false })) })
    }))

    // Single texts and the replies inbox.
    r.post('/bulksms/send-one', h(async (req, res) => {
      const b = req.body || {}, to = String(b.to || '').replace(/[\s().-]/g, '')
      if (!/^(\+|00)?1\d{10}$/.test(to)) return bad(res, 'err_number', 'Enter a USA or Canada mobile number (+1…).')
      if (await B.numberBusy(cidOf(req), B.normPhone(to) || to)) return fail(res, { error: 'err_number_busy', args: [(await B.cfg()).sessionHours] })
      const x = await sendSingle(req, to, String(b.text || ''), null, b.optOut)
      return x.error ? res.status(x.error === 'low_balance' ? 402 : 400).json(x) : res.json(x)
    }))
    r.get('/bulksms/conversations', h(async (req, res) => {
      const cid = cidOf(req), ss = await B.db().collection('bsSessions').find({ cid }).sort({ lastActivityAt: -1, createdAt: -1 }).limit(50).toArray()
      const out = []
      for (const s of ss) { const m = await B.db().collection('bsMessages').find({ cid, $or: [{ to: s.to }, { from: s.to }] }).sort({ createdAt: -1 }).limit(1).toArray(); out.push({ id: s._id, to: s.to, status: s.status, last: m[0] ? { body: m[0].body, direction: m[0].direction, at: m[0].createdAt } : null }) }
      res.json({ conversations: out })
    }))
    r.get('/bulksms/conversations/:id', h(async (req, res) => {
      const cid = cidOf(req), s = await B.db().collection('bsSessions').findOne({ _id: req.params.id, cid }); if (!s) return bad(res, 'not_found', 'Conversation not found.', 404)
      const ms = await B.db().collection('bsMessages').find({ cid, $or: [{ to: s.to }, { from: s.to }] }).sort({ createdAt: -1 }).limit(50).toArray()
      const rr = await B.replyRoute(cid, s._id)
      res.json({ id: s._id, to: s.to, canReply: !rr.error, why: rr.error ? msgOf(rr) : null, messages: ms.reverse().map(m => ({ id: m._id, direction: m.direction, body: m.body, status: m.status, at: m.createdAt })) })
    }))
    r.post('/bulksms/conversations/:id/reply', h(async (req, res) => {
      const cid = cidOf(req), s = await B.db().collection('bsSessions').findOne({ _id: req.params.id, cid }); if (!s) return bad(res, 'not_found', 'Conversation not found.', 404)
      const rr = await B.replyRoute(cid, s._id); if (rr.error) return fail(res, rr)
      const x = await sendSingle(req, s.to, String(req.body?.text || ''), s._id, true)
      return x.error ? res.status(x.error === 'low_balance' ? 402 : 400).json(x) : res.json(x)
    }))
  }

  // Engine notices for web customers (started / finished / refunds / incoming replies) → web inbox; refunds → wallet.
  async function deliver() {
    if (!B.db()) return
    for (const x of await B.dueReviews(BRAND)) await notify.push(x.chatId, x.kind === 'campaign' ? `Bulk SMS — how did your campaign “${x.name}” go? Rate it on the Bulk SMS page.` : `Bulk SMS — did your text to ${x.to} arrive? Answer on the Bulk SMS page to keep sending single texts.`).catch(() => {})
    const col = B.db().collection('bsNotify')
    for (let i = 0; i < 20; i++) {
      const x = await col.findOneAndUpdate({ brand: BRAND, sent: false }, { $set: { sent: true, sentAt: new Date() } }, { sort: { at: 1 } })
      const n = x?.value !== undefined ? x.value : x; if (!n) break
      if (n.type === 'refund' && n.amount) await credit(n.chatId, Number(n.amount))
      if (n.silent || n.type === 'admin' || n.type === 'channel') continue
      const text = n.key ? plain(t('en', n.key, ...(n.args || []))) : plain(n.text)
      await notify.push(n.chatId, `Bulk SMS — ${text}`, null, n.type === 'inbound' ? { kind: 'sms', meta: { bulksmsSession: n.sessionId || null } } : null).catch(e => log(`[BulkSMS web] notice: ${e.message}`))
    }
  }
  return { routes, deliver, BRAND }
}

module.exports = { createBulkSms, BRAND }
