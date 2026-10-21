// Admin controller for 💸 Reseller Payouts: inline-button callbacks (aPY:*) and typed amount/note steps.
const rp = require('./reseller-payouts')

const TTL_MS = 10 * 60 * 1000
const expired = () => rp.doneView('⌛ This payout screen expired — open 💸 Reseller Payouts again.')

function createPayoutAdmin({ getBot, getPending, setPending, log }) {
  const setStep = (adminId, v) => setPending(adminId, v ? { type: 'payout', ...v, ts: Date.now() } : null)

  async function show(chatId, view, messageId) {
    const bot = getBot()
    const opts = { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: view.keyboard } }
    if (messageId) {
      try { return await bot.editMessageText(view.text, { chat_id: chatId, message_id: messageId, ...opts }) } catch (e) { if (/not modified/i.test(e.message)) return }
    }
    return bot.sendMessage(chatId, view.text, opts)
  }

  async function open(chatId) {
    const loading = await getBot().sendMessage(chatId, '⏳ Loading reseller payouts…')
    return show(chatId, await rp.overview(), loading.message_id)
  }

  async function startPayout(adminId, rb, op, messageId) {
    const st = await rp.getState(rb)
    if (op === 'u') {
      if (!st.lastPayout) return show(adminId, rp.card(rb, st), messageId)
      await setStep(adminId, { step: 'undo', bot: rb.id, undoId: st.lastPayout.id })
      return show(adminId, rp.undoView(rb, st.lastPayout, st.eligible), messageId)
    }
    if (!(st.eligible > 0)) return show(adminId, rp.card(rb, st), messageId)
    const typed = op === 'amt'
    await setStep(adminId, { step: typed ? 'amount' : 'note', bot: rb.id, eligible: st.eligible, amount: typed ? null : st.eligible })
    return show(adminId, typed ? rp.amountPrompt(rb, st.eligible) : rp.notePrompt(rb, st.eligible), messageId)
  }

  async function finish(adminId, rb, p, admin, messageId) {
    if (p.step === 'confirm') {
      const r = await rp.record(rb, { amount: p.amount, note: p.note, requestId: p.requestId, admin })
      await setStep(adminId, null)
      log(`[ResellerPayouts] ${rb.id}: recorded ${rp.usd(r.payout.amount)} by ${admin.username || adminId}${r.duplicate ? ' (duplicate tap)' : ''} → eligible ${rp.usd(r.eligible)}`)
      return show(adminId, rp.doneView(`✅ Recorded <b>${rp.usd(r.payout.amount)}</b> paid to <b>${rp.esc(rb.name)}</b>.\nEligible now: <b>${rp.usd(r.eligible)}</b> · paid to date ${rp.usd(r.paidToDate)}.`), messageId)
    }
    const r = await rp.undoLast(rb, p.undoId, admin)
    await setStep(adminId, null)
    log(`[ResellerPayouts] ${rb.id}: undid ${rp.usd(r.undone.amount)} by ${admin.username || adminId} → eligible ${rp.usd(r.eligible)}`)
    return show(adminId, rp.doneView(`↩️ Undid the <b>${rp.usd(r.undone.amount)}</b> payout to <b>${rp.esc(rb.name)}</b>.\nEligible now: <b>${rp.usd(r.eligible)}</b>.`), messageId)
  }

  async function onCallback(query, cmd, adminId, ack) {
    const messageId = query.message?.message_id
    const admin = { chatId: String(adminId), username: query.from?.username || '' }
    const [op, id] = String(cmd).split(':')
    const pending = await getPending(adminId)
    const p = pending?.type === 'payout' && Date.now() - (pending.ts || 0) < TTL_MS ? pending : null
    const rb = rp.botById(id || p?.bot)
    await ack(op === 'ok' || op === 'uok' ? 'Saving…' : 'Loading…')
    try {
      if (op === 'list') return await show(adminId, await rp.overview(), messageId)
      if (op === 'x') { await setStep(adminId, null); return await show(adminId, rp.doneView('✖️ Cancelled — nothing was recorded.'), messageId) }
      if (!rb) return await show(adminId, expired(), messageId)
      if (op === 'o') return await show(adminId, rp.card(rb, await rp.getState(rb)), messageId)
      if (op === 'h') return await show(adminId, rp.history(rb, await rp.getState(rb)), messageId)
      if (op === 'all' || op === 'amt' || op === 'u') return await startPayout(adminId, rb, op, messageId)
      if (op === 'skip' && p?.step === 'note') {
        const next = { ...p, step: 'confirm', note: '', requestId: rp.newRequestId() }
        await setStep(adminId, next)
        return await show(adminId, rp.confirmView(rb, next), messageId)
      }
      if ((op === 'ok' && p?.step === 'confirm') || (op === 'uok' && p?.step === 'undo')) return await finish(adminId, rb, p, admin, messageId)
      return await show(adminId, expired(), messageId)
    } catch (e) {
      log(`[ResellerPayouts] ${op} ${rb?.id || ''} failed: ${e.message}`)
      return show(adminId, rp.doneView(`⚠️ ${rp.esc(e.message)}`), messageId)
    }
  }

  // Typed input while a payout screen waits for an amount or a note. Returns true when handled.
  async function onText(adminId, p, message) {
    const rb = rp.botById(p?.bot)
    if (!rb || (p.step !== 'amount' && p.step !== 'note')) return false
    if (p.step === 'amount') {
      const amt = rp.parseAmount(message)
      const err = !(amt > 0) ? `⚠️ "${rp.esc(String(message).slice(0, 30))}" isn't a valid amount.`
        : amt > p.eligible + 0.005 ? `⚠️ ${rp.usd(amt)} is more than the eligible ${rp.usd(p.eligible)}.` : null
      if (err) {
        const again = rp.amountPrompt(rb, p.eligible)
        await show(adminId, { ...again, text: `${err}\n\n${again.text}` })
        return true
      }
      await setStep(adminId, { ...p, step: 'note', amount: amt })
      await show(adminId, rp.notePrompt(rb, amt))
      return true
    }
    const next = { ...p, step: 'confirm', note: String(message).trim().slice(0, 200), requestId: rp.newRequestId() }
    await setStep(adminId, next)
    await show(adminId, rp.confirmView(rb, next))
    return true
  }

  return { open, onCallback, onText, show }
}

module.exports = { createPayoutAdmin }
